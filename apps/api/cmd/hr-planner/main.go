// Command hr-planner works out mission consumables from crew profiles, and
// packs and unpacks mission files.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"mars-console/api/internal/planner"
)

const usage = `hr-planner: crew profiles in, mission consumables out

  hr-planner types
      List mission types and phase presets.

  hr-planner pack <mission.json> [--roster <roster.json>] [-o <file.mhr>]
      Check a mission and write it as a binary mission file.

  hr-planner plan <file.mhr | mission.json> [--roster <roster.json>] [--detail] [--json]
      Work out food, water, oxygen and electricity for the mission.

  hr-planner unpack <file.mhr>
      Print a mission file as JSON.

  hr-planner demo
      Pack the example Mars mission, then plan from the packed file.`

// usageError is a mistake in the command line, as opposed to in a mission.
type usageError struct{ message string }

func (e *usageError) Error() string { return e.message }

type arguments struct {
	positional []string
	values     map[string]string
	switches   map[string]bool
}

func parseArguments(argv []string) (arguments, error) {
	args := arguments{values: map[string]string{}, switches: map[string]bool{}}
	for i := 0; i < len(argv); i++ {
		switch arg := argv[i]; {
		case arg == "--roster" || arg == "-o":
			i++
			if i == len(argv) {
				return args, &usageError{arg + " needs a value"}
			}
			args.values[arg] = argv[i]
		case arg == "--detail" || arg == "--json":
			args.switches[arg] = true
		case strings.HasPrefix(arg, "-"):
			return args, &usageError{"unknown option " + arg}
		default:
			args.positional = append(args.positional, arg)
		}
	}
	return args, nil
}

func (a arguments) file(what string) (string, error) {
	if len(a.positional) < 2 {
		return "", &usageError{"give " + what}
	}
	return a.positional[1], nil
}

func read(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, &planner.MissionError{Message: fmt.Sprintf("cannot read %s: %v", path, errors.Unwrap(err))}
	}
	return data, nil
}

// readRoster accepts a bare list of profiles or {"astronauts": [...]}.
func readRoster(path string) ([]byte, error) {
	if path == "" {
		return nil, nil
	}
	data, err := read(path)
	if err != nil {
		return nil, err
	}
	var wrapped struct {
		Astronauts json.RawMessage `json:"astronauts"`
	}
	if json.Unmarshal(data, &wrapped) == nil && wrapped.Astronauts != nil {
		return wrapped.Astronauts, nil
	}
	return data, nil
}

// readMission reads a packed file or a mission JSON. A packed file starts
// with a packet header; JSON starts with a brace.
func readMission(path, rosterPath string) (planner.Mission, error) {
	data, err := read(path)
	if err != nil {
		return planner.Mission{}, err
	}
	if !strings.HasPrefix(strings.TrimSpace(string(data[:min(len(data), 64)])), "{") {
		return planner.DecodeMission(data)
	}
	roster, err := readRoster(rosterPath)
	if err != nil {
		return planner.Mission{}, err
	}
	return planner.ParseMission(data, roster)
}

func indented(value any) string {
	text, _ := json.MarshalIndent(value, "", "  ")
	return string(text)
}

func pack(args arguments, out io.Writer) error {
	input, err := args.file("a mission JSON file")
	if err != nil {
		return err
	}
	mission, err := readMission(input, args.values["--roster"])
	if err != nil {
		return err
	}
	data, err := planner.EncodeMission(mission, planner.PacketOptions{})
	if err != nil {
		return err
	}
	target := args.values["-o"]
	if target == "" {
		target = strings.TrimSuffix(input, filepath.Ext(input)) + ".mhr"
	}
	if err := os.WriteFile(target, data, 0o644); err != nil {
		return &planner.MissionError{Message: fmt.Sprintf("cannot write %s: %v", target, errors.Unwrap(err))}
	}
	fmt.Fprintf(out, "Wrote %s\n\n%s\n", target, planner.FormatPacket(data, mission))
	return nil
}

func plan(args arguments, out io.Writer) error {
	path, err := args.file("a mission file")
	if err != nil {
		return err
	}
	mission, err := readMission(path, args.values["--roster"])
	if err != nil {
		return err
	}
	result := planner.PlanMission(mission)
	if args.switches["--json"] {
		fmt.Fprintln(out, indented(map[string]any{"mission": mission, "plan": result}))
	} else {
		fmt.Fprintln(out, planner.FormatPlan(mission, result, args.switches["--detail"]))
	}
	return nil
}

func unpack(args arguments, out io.Writer) error {
	path, err := args.file("a mission file")
	if err != nil {
		return err
	}
	data, err := read(path)
	if err != nil {
		return err
	}
	mission, err := planner.DecodeMission(data)
	if err != nil {
		return err
	}
	fmt.Fprintln(out, indented(mission))
	return nil
}

// demo walks the whole path a mission takes: JSON on the ground, bytes on
// the link, a plan on the other side. The example is built into the program.
func demo(out io.Writer) error {
	source, err := planner.Examples.ReadFile("examples/gale-expedition.json")
	if err != nil {
		return err
	}
	rosterFile, err := planner.Examples.ReadFile("examples/roster.json")
	if err != nil {
		return err
	}
	var roster struct {
		Astronauts json.RawMessage `json:"astronauts"`
	}
	if err := json.Unmarshal(rosterFile, &roster); err != nil {
		return err
	}
	mission, err := planner.ParseMission(source, roster.Astronauts)
	if err != nil {
		return err
	}
	data, err := planner.EncodeMission(mission, planner.PacketOptions{})
	if err != nil {
		return err
	}
	file := filepath.Join(os.TempDir(), "gale-expedition.mhr")
	if err := os.WriteFile(file, data, 0o644); err != nil {
		return err
	}
	fmt.Fprintf(out, "1. Packed the example mission and roster into %s\n\n%s\n", file, planner.FormatPacket(data, mission))
	received, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	decoded, err := planner.DecodeMission(received)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "\n2. Read %s back and planned from the file alone\n\n%s\n", file,
		planner.FormatPlan(decoded, planner.PlanMission(decoded), false))
	return nil
}

// run returns the process exit code: 0 for success, 1 for a bad mission or
// file, 2 for a bad command.
func run(argv []string, out, errOut io.Writer) int {
	args, err := parseArguments(argv)
	if err == nil {
		command := ""
		if len(args.positional) > 0 {
			command = args.positional[0]
		}
		switch command {
		case "types":
			fmt.Fprintln(out, planner.FormatTypes())
		case "pack":
			err = pack(args, out)
		case "plan":
			err = plan(args, out)
		case "unpack":
			err = unpack(args, out)
		case "demo":
			err = demo(out)
		case "", "help":
			fmt.Fprintln(out, usage)
		default:
			err = &usageError{"unknown command " + command}
		}
	}
	var badUsage *usageError
	switch {
	case err == nil:
		return 0
	case errors.As(err, &badUsage):
		fmt.Fprintf(errOut, "%s\n\n%s\n", badUsage.message, usage)
		return 2
	default:
		fmt.Fprintln(errOut, err)
		return 1
	}
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
