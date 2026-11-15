package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const examples = "../../internal/planner/examples/"

func cli(args ...string) (code int, out, errOut string) {
	var stdout, stderr bytes.Buffer
	code = run(args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestPackPlanUnpack(t *testing.T) {
	file := filepath.Join(t.TempDir(), "gale-expedition.mhr")

	code, out, _ := cli("pack", examples+"gale-expedition.json", "--roster", examples+"roster.json", "-o", file)
	data, err := os.ReadFile(file)
	if code != 0 || err != nil || len(data) != 273 || !strings.Contains(out, "PACKET  273 bytes") {
		t.Fatalf("pack: code %d, %d bytes, %v\n%s", code, len(data), err, out)
	}

	_, packed, _ := cli("plan", file, "--json")
	_, source, _ := cli("plan", examples+"gale-expedition.json", "--roster", examples+"roster.json", "--json")
	var result struct{ Plan struct{ Days int } }
	if err := json.Unmarshal([]byte(packed), &result); err != nil || packed != source || result.Plan.Days != 960 {
		t.Errorf("plan from the file and from the JSON differ, or days = %d (%v)", result.Plan.Days, err)
	}

	code, out, _ = cli("plan", file, "--detail")
	for _, want := range []string{
		"Gale expedition  mars-long-stay  960 days  6 crew  margin 40%",
		"NUTRIENT TARGETS",
		"BASE    4.5895°S 137.4417°E",
		"drill: 2 m core",
	} {
		if code != 0 || !strings.Contains(out, want) {
			t.Errorf("plan --detail misses %q", want)
		}
	}

	code, out, _ = cli("unpack", file)
	var mission struct{ Name, Type string }
	if err := json.Unmarshal([]byte(out), &mission); code != 0 || err != nil || mission.Name != "Gale expedition" || mission.Type != "mars-long-stay" {
		t.Errorf("unpack: code %d, %+v, %v", code, mission, err)
	}

	// Without -o the file lands next to the JSON.
	copied := filepath.Join(t.TempDir(), "gale.json")
	gale, _ := os.ReadFile(examples + "gale-traverse.json")
	_ = os.WriteFile(copied, gale, 0o644)
	if code, _, _ := cli("pack", copied); code != 0 {
		t.Errorf("pack without -o: code %d", code)
	}
	if _, err := os.Stat(strings.TrimSuffix(copied, ".json") + ".mhr"); err != nil {
		t.Errorf("pack without -o wrote nothing: %v", err)
	}
}

func TestTypesDemoAndHelp(t *testing.T) {
	if code, out, _ := cli("types"); code != 0 || !strings.Contains(out, "mars-long-stay") {
		t.Errorf("types: code %d", code)
	}
	if code, out, _ := cli("demo"); code != 0 || !strings.Contains(out, "MISSION TOTALS") {
		t.Errorf("demo: code %d", code)
	}
	if code, out, _ := cli(); code != 0 || !strings.Contains(out, "hr-planner pack") {
		t.Errorf("no arguments: code %d", code)
	}
}

func TestFailuresExitWithAReason(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "good.mhr")
	cli("pack", examples+"gale-expedition.json", "--roster", examples+"roster.json", "-o", good)

	data, _ := os.ReadFile(good)
	data[30] ^= 1
	damaged := filepath.Join(dir, "damaged.mhr")
	_ = os.WriteFile(damaged, data, 0o644)
	if code, _, errOut := cli("plan", damaged); code != 1 || !strings.Contains(errOut, "checksum mismatch") {
		t.Errorf("damaged file: code %d, %q", code, errOut)
	}

	bad := filepath.Join(dir, "bad.json")
	_ = os.WriteFile(bad, []byte(`{"type":"custom","crew":["VEGA"]}`), 0o644)
	if code, _, errOut := cli("plan", bad); code != 1 || !strings.Contains(errOut, `no "VEGA" in the roster`) {
		t.Errorf("bad mission: code %d, %q", code, errOut)
	}

	if code, _, errOut := cli("plan", filepath.Join(dir, "missing.mhr")); code != 1 || !strings.Contains(errOut, "cannot read") {
		t.Errorf("missing file: code %d, %q", code, errOut)
	}
	for _, args := range [][]string{{"launch"}, {"pack"}, {"plan", good, "--speed"}, {"pack", bad, "-o"}} {
		if code, _, errOut := cli(args...); code != 2 || !strings.Contains(errOut, "hr-planner types") {
			t.Errorf("%v: code %d, want 2 with the usage text", args, code)
		}
	}
}
