package env

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func respond(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(bytes.NewBufferString(body)), ContentLength: int64(len(body))}
}

const remsFeed = `{"descriptions":{},"soles":[
 {"id":"2","terrestrial_date":"2026-08-25","sol":"4995","ls":"341","season":"Month 12","min_temp":"-71","max_temp":"-5","pressure":"777","atmo_opacity":"Sunny","sunrise":"06:46","sunset":"18:51","local_uv_irradiance_index":"Moderate","min_gts_temp":"-84","max_gts_temp":"4"},
 {"id":"1","terrestrial_date":"2026-08-24","sol":"4994","ls":"340","min_temp":"--","max_temp":"--","pressure":"--"},
 {"id":"0","terrestrial_date":"2026-08-23","sol":"4993","ls":"340","min_temp":"-70","max_temp":"-6","pressure":"778"}]}`

func TestParseFeedNormalizesUnitsAndDropsEmptySols(t *testing.T) {
	readings, err := parseFeed([]byte(remsFeed), "soles")
	if err != nil {
		t.Fatal(err)
	}
	if len(readings) != 2 || readings[0].Sol != 4993 || readings[1].Sol != 4995 {
		t.Fatalf("readings = %+v, want sols 4993 and 4995 oldest first", readings)
	}
	latest := readings[1]
	near := func(got *float64, want float64) bool { return got != nil && math.Abs(*got-want) < 1e-9 }
	if !near(latest.AirMinK, 202.15) || !near(latest.GroundMaxK, 277.15) || !near(latest.PressurePa, 777) {
		t.Fatalf("latest = %+v", latest)
	}
	if latest.Opacity != "Sunny" || latest.Sunset != "18:51" {
		t.Fatalf("latest text fields = %+v", latest)
	}
}

func TestParseFeedReadsNumbersAndMissingChannels(t *testing.T) {
	medaFeed := `{"sols":[{"sol":"1133","terrestrial_date":"2024-04-27","min_temp":-79.3,"max_temp":-24.7,"pressure":778.9},{"sol":"1132","min_temp":"--","pressure":"--"}]}`
	readings, err := parseFeed([]byte(medaFeed), "sols")
	if err != nil || len(readings) != 1 {
		t.Fatalf("readings = %+v, err = %v", readings, err)
	}
	if readings[0].GroundMinK != nil || *readings[0].PressurePa != 778.9 {
		t.Fatalf("reading = %+v", readings[0])
	}
	if _, err := parseFeed([]byte(`{"other":[]}`), "sols"); err == nil {
		t.Fatal("expected an error for a feed without its list")
	}
}

func TestWeatherServesStaleCopyWhenUpstreamFails(t *testing.T) {
	fail := false
	calls := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if fail {
			return nil, errors.New("down")
		}
		if r.URL.String() != stations["gale"].Feed {
			t.Errorf("upstream = %s", r.URL)
		}
		return respond(200, remsFeed), nil
	})}
	mux := http.NewServeMux()
	RegisterWeather(mux, client)

	get := func(path string) (*httptest.ResponseRecorder, Report) {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		var report Report
		_ = json.Unmarshal(w.Body.Bytes(), &report)
		return w, report
	}
	w, report := get("/api/weather/gale")
	if w.Code != 200 || report.Latest.Sol != 4995 || report.Stale || len(report.History) != 2 {
		t.Fatalf("code %d report %+v", w.Code, report)
	}
	get("/api/weather/gale")
	if calls != 1 {
		t.Fatalf("calls = %d, want the second request served from cache", calls)
	}
	if w, _ := get("/api/weather/mars"); w.Code != http.StatusNotFound {
		t.Fatalf("unknown station code = %d", w.Code)
	}
	fail = true
	mux2 := http.NewServeMux()
	RegisterWeather(mux2, client)
	w = httptest.NewRecorder()
	mux2.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/weather/jezero", nil))
	if w.Code != http.StatusBadGateway {
		t.Fatalf("code without a cached copy = %d, want 502", w.Code)
	}
}

func TestGeologyLooksUpAndCachesUnits(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if !strings.HasPrefix(r.URL.String(), geologyIdentify) || r.URL.Query().Get("geometry") != "137.4400,-4.5900" {
			t.Errorf("upstream = %s", r.URL)
		}
		return respond(200, `{"results":[{"attributes":{"Unit":"AHi","UnitDesc":"Amazonian and Hesperian impact unit"}}]}`), nil
	})}
	mux := http.NewServeMux()
	RegisterGeology(mux, client)
	get := func(query string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, geologyPath+query, nil))
		return w
	}
	w := get("?lat=-4.5895&lon=137.4417")
	var unit Unit
	if err := json.Unmarshal(w.Body.Bytes(), &unit); err != nil || w.Code != 200 || unit.Unit != "AHi" {
		t.Fatalf("code %d body %s", w.Code, w.Body)
	}
	get("?lat=-4.5899&lon=137.4401")
	if calls != 1 {
		t.Fatalf("calls = %d, want nearby points to share one lookup", calls)
	}
	if w := get("?lat=95&lon=0"); w.Code != http.StatusBadRequest {
		t.Fatalf("out of range code = %d", w.Code)
	}
}

func TestGeologyReportsNoUnit(t *testing.T) {
	unit, err := parseIdentify([]byte(`{"results":[]}`))
	if err != nil || unit != nil {
		t.Fatalf("unit = %+v, err = %v", unit, err)
	}
}

const enlilRuns = `[
 {"simulationID":"WSA-ENLIL/1/1","modelCompletionTime":"2026-11-09T19:32Z","link":"https://ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/1/-1",
  "cmeInputs":[{"CMEID":"2026-11-08T12:00:00-CME-001","cmeStartTime":"2026-11-08T12:00Z","speed":610,"isMostAccurate":true}],
  "impactList":[{"location":"Mars","arrivalTime":"2026-11-13T12:00Z","isGlancingBlow":true,"isMinorImpact":false},{"location":"Psyche","arrivalTime":"2026-11-12T00:00Z"}]},
 {"simulationID":"WSA-ENLIL/2/1","modelCompletionTime":"2026-11-09T19:59Z","link":"https://ccmc.gsfc.nasa.gov/DONKI/view/WSA-ENLIL/2/-1",
  "cmeInputs":[{"CMEID":"2026-11-08T12:00:00-CME-001","cmeStartTime":"2026-11-08T12:00Z","speed":650,"isMostAccurate":true}],
  "impactList":[{"location":"Mars","arrivalTime":"2026-11-13T15:00Z","isGlancingBlow":false,"isMinorImpact":false}]},
 {"simulationID":"WSA-ENLIL/3/1","modelCompletionTime":"2026-10-30T13:36Z","link":"x",
  "cmeInputs":[{"CMEID":"2026-10-29T01:00:00-CME-001","cmeStartTime":"2026-10-29T01:00Z","speed":420}],
  "impactList":[{"location":"Mars","arrivalTime":"2026-11-04T08:00Z","isGlancingBlow":false,"isMinorImpact":true}]},
 {"simulationID":"WSA-ENLIL/4/1","modelCompletionTime":"2026-11-13T16:13Z","cmeInputs":[],"impactList":null}
]`

func TestParseEnlilKeepsNewestMarsArrivalPerCME(t *testing.T) {
	arrivals, err := parseEnlil([]byte(enlilRuns))
	if err != nil {
		t.Fatal(err)
	}
	if len(arrivals) != 2 {
		t.Fatalf("arrivals = %+v, want two CMEs", arrivals)
	}
	first, second := arrivals[0], arrivals[1]
	if !first.Minor || first.Arrival.Format("2006-01-02T15:04Z") != "2026-11-04T08:00Z" {
		t.Fatalf("first = %+v", first)
	}
	if second.SimulationID != "WSA-ENLIL/2/1" || second.Glancing || second.SpeedKmS != 650 {
		t.Fatalf("second = %+v, want the newer run of the same CME", second)
	}
}

func TestSpaceWeatherCachesAndFallsBack(t *testing.T) {
	calls := 0
	fail := false
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		calls++
		if !strings.HasPrefix(r.URL.String(), donkiEnlil) || r.URL.Query().Get("api_key") == "" {
			t.Errorf("upstream = %s", r.URL)
		}
		if fail {
			return nil, errors.New("down")
		}
		return respond(200, enlilRuns), nil
	})}
	mux := http.NewServeMux()
	RegisterSpaceWeather(mux, client)
	get := func() (int, SpaceWeather) {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, spaceWeatherPath, nil))
		var report SpaceWeather
		_ = json.Unmarshal(w.Body.Bytes(), &report)
		return w.Code, report
	}
	code, report := get()
	if code != 200 || len(report.Arrivals) != 2 || report.Stale {
		t.Fatalf("code %d report %+v", code, report)
	}
	get()
	if calls != 1 {
		t.Fatalf("calls = %d, want one upstream request per hour", calls)
	}
	fail = true
	mux2 := http.NewServeMux()
	RegisterSpaceWeather(mux2, client)
	w := httptest.NewRecorder()
	mux2.ServeHTTP(w, httptest.NewRequest(http.MethodGet, spaceWeatherPath, nil))
	if w.Code != http.StatusBadGateway {
		t.Fatalf("code with nothing cached = %d", w.Code)
	}
}
