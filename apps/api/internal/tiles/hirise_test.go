package tiles

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHiRISEServesAllowlistOnly(t *testing.T) {
	pngData := scienceFixture(t, 256, false)
	var upstream string
	client := &http.Client{Transport: scienceTransport(func(r *http.Request) (*http.Response, error) {
		upstream = r.URL.String()
		return scienceResponse(200, "image/png", pngData), nil
	})}
	mux := http.NewServeMux()
	flush := RegisterHiRISE(mux, t.TempDir(), client)
	t.Cleanup(flush)

	get := func(path string) int {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, hirisePath+path, nil))
		return w.Code
	}
	if code := get("/gale/16/34420/115579.png"); code != 200 {
		t.Fatalf("gale tile status %d", code)
	}
	want := "https://trek.nasa.gov/tiles/Mars/EQ/curiosity_hirise_mosaic/1.0.0/default/default028mm/16/34420/115579.png"
	if upstream != want {
		t.Errorf("upstream = %s, want %s", upstream, want)
	}
	if code := get("/gale/17/0/0.png"); code != http.StatusBadRequest {
		t.Errorf("level past the mosaic's deepest matrix: status %d", code)
	}
	if code := get("/themis-day/0/0/0.png"); code != http.StatusNotFound {
		t.Errorf("science layer through the HiRISE route: status %d", code)
	}
}
