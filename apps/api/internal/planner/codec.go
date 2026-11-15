package planner

import (
	"encoding/json"
	"fmt"
	"slices"
)

// A mission file is one CCSDS Space Packet (CCSDS 133.0-B-2), big-endian.
//
//	primary header, 6 bytes
//	  3 bits  packet version, 000
//	  1 bit   type, 1 = telecommand (ground to crew)
//	  1 bit   secondary header flag, 0
//	  11 bits application process id
//	  2 bits  sequence flags, 11 = whole message in this packet
//	  14 bits sequence count
//	  16 bits length of everything after the header, minus one
//	mission
//	  u8      format version (high 4 bits), mission type (low 4 bits)
//	  u8      margin, percent
//	  u8      crew count
//	  u8      phase count
//	  u8      site count
//	  u8      task count
//	  text    mission name: u8 length, then ASCII
//	per crew member
//	  u8      sex (bit 7), role (bits 6-4), activity (bits 3-2), bits 1-0 zero
//	  u8      age, years
//	  u16     mass, 0.1 kg
//	  u8      height, cm
//	  u8      EVA share, percent
//	  text    name
//	per phase
//	  u8      kind
//	  u16     days
//	  u8      mask of parameters that differ from the kind's preset, then the
//	          value of each one in paramFields order
//	per site
//	  i32     latitude, millionths of a degree
//	  i32     longitude, millionths of a degree, east positive
//	  text    name
//	per task
//	  u8      site, position in the site list
//	  u8      phase, position in the phase list
//	  u8      first crew member, position in the crew list, 255 = nobody yet
//	  u8      EVA (bit 7), crew members after the first (bits 6-3), kind (bits 2-0)
//	  u8      each crew member after the first, position in the crew list
//	  u8      hours, in half hours
//	  text    note
//	version 4 only
//	  u16     byte length of UTF-8 JSON object with markers, briefing, site descriptions and plan
//	  bytes   JSON object, validated with the mission
//	u16       CRC-16/CCITT-FALSE over every byte before it
//
// Version 2 added sites and tasks. Version 3 lets a task have more than one
// crew member. A version 2 file reads as a version 3 file whose tasks have at
// most one. Version 4 adds symbols, a briefing, site descriptions and the plan after
// the tasks. Missions without those fields still write version 3. Versions 2
// to 4 are read.
const (
	FormatVersion = 4
	// The oldest version DecodePacket reads.
	oldestVersion = 2
	// DefaultAPID is a placeholder. A real mission assigns its own
	// application process ids.
	DefaultAPID = 0x2a0

	nobody         = 0xff
	headerBytes    = 6
	crcBytes       = 2
	maxPacketBytes = headerBytes + 65536
)

// CRC16 is the checksum CCSDS uses on command and telemetry frames:
// polynomial 0x1021, start value 0xFFFF.
func CRC16(data []byte) uint16 {
	crc := uint16(0xffff)
	for _, b := range data {
		crc ^= uint16(b) << 8
		for range 8 {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

// PacketOptions sets the packet header fields a mission does not decide.
type PacketOptions struct {
	// APID is the application process id, 0 to 2047. Zero means DefaultAPID.
	APID          int
	SequenceCount int
}

type writer struct{ out []byte }

func (w *writer) u8(value int)  { w.out = append(w.out, byte(value)) }
func (w *writer) u16(value int) { w.out = append(w.out, byte(value>>8), byte(value)) }
func (w *writer) i32(value int32) {
	w.out = append(w.out, byte(value>>24), byte(value>>16), byte(value>>8), byte(value))
}
func (w *writer) text(value string) {
	w.u8(len(value))
	w.out = append(w.out, value...)
}

// EncodeMission writes the mission as a mission file.
func EncodeMission(input Mission, options PacketOptions) ([]byte, error) {
	// Re-validate, so a hand-built mission cannot overflow a field.
	mission, err := Normalize(input)
	if err != nil {
		return nil, err
	}
	apid := options.APID
	if apid == 0 {
		apid = DefaultAPID
	}
	if apid < 0 || apid > 0x7ff {
		return nil, &MissionError{"apid must be an integer from 0 to 2047"}
	}
	if options.SequenceCount < 0 || options.SequenceCount > 0x3fff {
		return nil, &MissionError{"sequenceCount must be an integer from 0 to 16383"}
	}

	w := &writer{}
	w.u16(1<<12 | apid)
	w.u16(0b11<<14 | options.SequenceCount)
	w.u16(0) // length, filled in below

	version := 3
	if len(mission.Markers) > 0 || mission.Briefing != "" || siteDescriptions(mission.Sites) != nil || len(mission.Route) > 0 || taskStops(mission.Tasks) != nil {
		version = FormatVersion
	}
	w.u8(version<<4 | slices.Index(MissionTypes, mission.Type))
	w.u8(mission.MarginPercent)
	w.u8(len(mission.Crew))
	w.u8(len(mission.Phases))
	w.u8(len(mission.Sites))
	w.u8(len(mission.Tasks))
	w.text(mission.Name)

	for _, person := range mission.Crew {
		w.u8(slices.Index(Sexes, person.Sex)<<7 |
			slices.Index(Roles, person.Role)<<4 |
			slices.Index(Activities, person.Activity)<<2)
		w.u8(person.Age)
		w.u16(int(stored(person.MassKg, 1, 10)))
		w.u8(person.HeightCm)
		w.u8(int(stored(person.EVAShare, 1, 100)))
		w.text(person.Name)
	}

	for _, phase := range mission.Phases {
		preset := PhasePresets[phase.Kind].PhaseParams
		mask := 0
		for bit, field := range paramFields {
			if *field.of(&phase.PhaseParams) != *field.of(&preset) {
				mask |= 1 << bit
			}
		}
		w.u8(slices.Index(PhaseKinds, phase.Kind))
		w.u16(phase.Days)
		w.u8(mask)
		for bit, field := range paramFields {
			if mask&(1<<bit) == 0 {
				continue
			}
			value := int(stored(*field.of(&phase.PhaseParams), field.num, field.den))
			if field.bytes == 1 {
				w.u8(value)
			} else {
				w.u16(value)
			}
		}
	}

	for _, site := range mission.Sites {
		w.i32(int32(stored(site.Lat, 1, 1e6)))
		w.i32(int32(stored(site.Lon, 1, 1e6)))
		w.text(site.Name)
	}

	for _, task := range mission.Tasks {
		w.u8(task.Site)
		w.u8(task.Phase)
		first, others := nobody, []int(nil)
		if len(task.Crew) > 0 {
			first, others = task.Crew[0], task.Crew[1:]
		}
		w.u8(first)
		flags := slices.Index(TaskKinds, task.Kind) | len(others)<<3
		if task.EVA {
			flags |= 1 << 7
		}
		w.u8(flags)
		for _, person := range others {
			w.u8(person)
		}
		w.u8(int(stored(task.Hours, 1, 2)))
		w.text(task.Note)
	}

	if version >= 4 {
		extra, err := json.Marshal(missionExtras{Markers: mission.Markers, Briefing: mission.Briefing, SiteDescriptions: siteDescriptions(mission.Sites), Route: mission.Route, TaskStops: taskStops(mission.Tasks)})
		if err != nil {
			return nil, err
		}
		if len(extra) > 65535 {
			return nil, &MissionError{"mission symbols and briefing exceed 65535 bytes; shorten the briefing or remove symbols"}
		}
		w.u16(len(extra))
		w.out = append(w.out, extra...)
	}
	dataLength := len(w.out) - headerBytes + crcBytes
	if dataLength > 65536 {
		return nil, &MissionError{"mission exceeds one space packet; shorten the briefing or remove tasks or symbols"}
	}
	w.out[4] = byte((dataLength - 1) >> 8)
	w.out[5] = byte(dataLength - 1)
	w.u16(int(CRC16(w.out)))
	return w.out, nil
}

// Packet is a decoded mission file.
type Packet struct {
	Mission       Mission
	APID          int
	SequenceCount int
}

// reader walks the bytes before the checksum. Reading past them sets short,
// and every read after that returns zero.
type reader struct {
	data  []byte
	at    int
	short bool
}

func (r *reader) u8() int {
	if r.at >= len(r.data) {
		r.short = true
		return 0
	}
	r.at++
	return int(r.data[r.at-1])
}
func (r *reader) u16() int   { return r.u8()<<8 | r.u8() }
func (r *reader) i32() int32 { return int32(uint32(r.u16())<<16 | uint32(r.u16())) }
func (r *reader) text() string {
	length := r.u8()
	text := make([]byte, 0, length)
	for range length {
		text = append(text, byte(r.u8()))
	}
	return string(text)
}

// DecodePacket reads a mission file. It returns a *MissionError when the
// bytes are not a whole, undamaged mission packet of a version this code knows.
func DecodePacket(data []byte) (Packet, error) {
	refuse := func(format string, args ...any) (Packet, error) {
		return Packet{}, &MissionError{"not a valid mission file: " + fmt.Sprintf(format, args...)}
	}
	if len(data) < headerBytes+crcBytes || len(data) > maxPacketBytes {
		return refuse("%d bytes is outside the size of a packet", len(data))
	}
	r := &reader{data: data[:len(data)-crcBytes]}

	word := r.u16()
	switch {
	case word>>13 != 0:
		return refuse("packet version is not 0")
	case word>>12&1 != 1:
		return refuse("it is not a telecommand packet")
	case word>>11&1 != 0:
		return refuse("unexpected secondary header")
	}
	sequence := r.u16()
	if sequence>>14 != 0b11 {
		return refuse("it is one segment of a longer message")
	}
	if r.u16()+1 != len(data)-headerBytes {
		return refuse("length field does not match the file size")
	}

	// Check the whole packet before trusting any field in it.
	body, tail := data[:len(data)-crcBytes], data[len(data)-crcBytes:]
	if CRC16(body) != uint16(tail[0])<<8|uint16(tail[1]) {
		return refuse("checksum mismatch, the file is damaged")
	}

	first := r.u8()
	version := first >> 4
	if version < oldestVersion || version > FormatVersion {
		return refuse("format version %d, this reader knows versions %d to %d", version, oldestVersion, FormatVersion)
	}
	var unknown string
	pick := func(options []string, index int, what string) string {
		if index >= len(options) {
			if unknown == "" {
				unknown = fmt.Sprintf("unknown %s %d", what, index)
			}
			return ""
		}
		return options[index]
	}
	mission := map[string]any{"type": pick(MissionTypes, first&0x0f, "mission type")}
	mission["marginPercent"] = float64(r.u8())
	crewCount, phaseCount, siteCount, taskCount := r.u8(), r.u8(), r.u8(), r.u8()
	mission["name"] = r.text()

	reserved := ""
	crew := make([]any, crewCount)
	for i := range crew {
		flags := r.u8()
		if flags&0b11 != 0 {
			reserved = "reserved crew bits are set"
		}
		crew[i] = map[string]any{
			"sex":      pick(Sexes, flags>>7, "sex"),
			"role":     pick(Roles, flags>>4&0b111, "role"),
			"activity": pick(Activities, flags>>2&0b11, "activity"),
			"age":      float64(r.u8()),
			"massKg":   float64(r.u16()) / 10,
			"heightCm": float64(r.u8()),
			"evaShare": float64(r.u8()) / 100,
			"name":     r.text(),
		}
	}

	phases := make([]any, phaseCount)
	for i := range phases {
		phase := map[string]any{"kind": pick(PhaseKinds, r.u8(), "phase kind"), "days": float64(r.u16())}
		mask := r.u8()
		if mask>>len(paramFields) != 0 {
			reserved = "unknown phase parameter"
		}
		for bit, field := range paramFields {
			if mask&(1<<bit) == 0 {
				continue
			}
			value := r.u8()
			if field.bytes == 2 {
				value = value<<8 | r.u8()
			}
			phase[field.key] = float64(value) * field.num / field.den
		}
		phases[i] = phase
	}

	sites := make([]any, siteCount)
	for i := range sites {
		lat, lon := r.i32(), r.i32()
		sites[i] = map[string]any{"lat": float64(lat) / 1e6, "lon": float64(lon) / 1e6, "name": r.text()}
	}

	tasks := make([]any, taskCount)
	for i := range tasks {
		task := map[string]any{"site": float64(r.u8()), "phase": float64(r.u8())}
		people := []any{}
		if person := r.u8(); person != nobody {
			people = append(people, float64(person))
		}
		flags := r.u8()
		others := flags >> 3 & 0b1111
		switch {
		case version == 2 && others != 0:
			reserved = "reserved task bits are set"
		case others != 0 && len(people) == 0:
			reserved = "a task lists more crew members after nobody"
		}
		for range others {
			people = append(people, float64(r.u8()))
		}
		task["crew"] = people
		task["eva"] = flags>>7 == 1
		task["kind"] = pick(TaskKinds, flags&0b111, "task kind")
		task["hours"] = float64(r.u8()) / 2
		task["note"] = r.text()
		tasks[i] = task
	}

	if version >= 4 {
		length := r.u16()
		if r.short || length > len(r.data)-r.at {
			return refuse("it ends before the symbols and briefing do")
		}
		var extra map[string]any
		if err := json.Unmarshal(r.data[r.at:r.at+length], &extra); err != nil || extra == nil {
			return refuse("symbols and briefing are not a JSON object")
		}
		r.at += length
		mission["markers"], mission["briefing"], mission["route"] = extra["markers"], extra["briefing"], extra["route"]
		// Entries past the last site are ignored.
		if stops, ok := extra["taskStops"].([]any); ok {
			for i, stop := range stops {
				if at, isNumber := stop.(float64); isNumber && at >= 0 && i < len(tasks) {
					tasks[i].(map[string]any)["stop"] = at
				}
			}
		}
		if descriptions, ok := extra["siteDescriptions"].([]any); ok {
			for i, text := range descriptions {
				if i < len(sites) && text != "" {
					sites[i].(map[string]any)["description"] = text
				}
			}
		}
	}

	switch {
	case r.short:
		return refuse("it ends before the mission does")
	case unknown != "":
		return refuse("%s", unknown)
	case reserved != "":
		return refuse("%s", reserved)
	case r.at != len(r.data):
		return refuse("extra bytes after the last task")
	}
	mission["crew"], mission["phases"], mission["sites"], mission["tasks"] = crew, phases, sites, tasks

	// Range checks live in parseMission, the same ones JSON input gets.
	parsed, err := parseMission(mission, nil)
	if err != nil {
		return refuse("%s", err.Error())
	}
	return Packet{parsed, word & 0x7ff, sequence & 0x3fff}, nil
}

// DecodeMission reads a mission file and returns the mission in it.
func DecodeMission(data []byte) (Mission, error) {
	packet, err := DecodePacket(data)
	return packet.Mission, err
}

// LinkEstimate is how long a file takes on one of Curiosity's links.
type LinkEstimate struct {
	ID            string  `json:"id"`
	Label         string  `json:"label"`
	BitsPerSecond int     `json:"bitsPerSecond"`
	Seconds       float64 `json:"seconds"`
}

// Rates are from Makovsky, Ilott and Taylor, "Mars Science Laboratory
// Telecommunications System Design", JPL DESCANSO Design and Performance
// Summary Series, Article 14, November 2009.
var curiosityLinks = []LinkEstimate{
	{ID: "x-band-lga", Label: "X-band, low-gain antenna in safe mode at maximum range", BitsPerSecond: 15},
	{ID: "x-band-hga", Label: "X-band, high-gain antenna, typical direct-from-Earth uplink", BitsPerSecond: 1000},
	{ID: "uhf-mro", Label: "UHF relay through Mars Reconnaissance Orbiter, baseline forward link", BitsPerSecond: 32000},
}

// DailyCommandBits is what the daily command session through the high-gain
// antenna carries: about 225 kilobits in 15 minutes (section 2.2.1.2 of the
// same article).
const DailyCommandBits = 225_000

// LinkEstimates gives the time on the wire for a file's own bits. Channel
// coding and frame headers add to this.
func LinkEstimates(byteLength int) []LinkEstimate {
	estimates := slices.Clone(curiosityLinks)
	for i := range estimates {
		estimates[i].Seconds = float64(byteLength*8) / float64(estimates[i].BitsPerSecond)
	}
	return estimates
}

// ShareOfDailyCommands is the part of the daily command session a file takes.
func ShareOfDailyCommands(byteLength int) float64 {
	return float64(byteLength*8) / DailyCommandBits
}
