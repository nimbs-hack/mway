package tiles

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

func ctxTestEncode(t *testing.T, img image.Image, format string) []byte {
	t.Helper()
	var out bytes.Buffer
	var err error
	switch format {
	case "png":
		err = png.Encode(&out, img)
	case "jpeg":
		err = jpeg.Encode(&out, img, nil)
	case "gif":
		err = gif.Encode(&out, img, nil)
	default:
		t.Fatalf("unknown test format %q", format)
	}
	if err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func ctxTestSolid(t *testing.T, c color.Color, format string) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, ctxTileSize, ctxTileSize))
	for y := 0; y < ctxTileSize; y++ {
		for x := 0; x < ctxTileSize; x++ {
			img.Set(x, y, c)
		}
	}
	return ctxTestEncode(t, img, format)
}

func TestTileImageValidation(t *testing.T) {
	for _, format := range []string{"png", "jpeg"} {
		t.Run(format, func(t *testing.T) {
			data := ctxTestSolid(t, color.Gray{Y: 136}, format)
			before := bytes.Clone(data)
			if got := tileImageType(data); got != "image/"+format {
				t.Fatalf("MIME = %q", got)
			}
			if err := validateTileImage(data); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(data, before) {
				t.Fatal("validation modified encoded bytes")
			}
			truncated := data[:len(data)-40]
			if tileImageType(truncated) == "" {
				t.Fatal("fixture must retain a valid image config")
			}
			if err := validateTileImage(truncated); err == nil {
				t.Fatal("accepted a truncated image with valid dimensions")
			}
			for _, bounds := range []image.Rectangle{image.Rect(0, 0, 511, 512), image.Rect(0, 0, 512, 513)} {
				wrongSize := ctxTestEncode(t, image.NewGray(bounds), format)
				if tileImageType(wrongSize) != "" || validateTileImage(wrongSize) == nil {
					t.Fatalf("accepted dimensions %v", bounds)
				}
			}
			for _, length := range []int{0, 1, 2, 10, 24} {
				if validateTileImage(data[:length]) == nil {
					t.Fatalf("accepted %d-byte header", length)
				}
			}
		})
	}
	gifData := ctxTestSolid(t, color.Black, "gif")
	for _, data := range [][]byte{gifData, make([]byte, 128), []byte("<html>"), {0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff}} {
		if tileImageType(data) != "" || validateTileImage(data) == nil {
			t.Fatal("accepted unsupported or malformed image")
		}
	}
}

func TestRebuildCTXImageAreaAverage(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, ctxTileSize, ctxTileSize))
	for y := 0; y < ctxTileSize; y++ {
		for x := 0; x < ctxTileSize; x++ {
			// One opaque red pixel and three invisible blue pixels per area.
			c := color.NRGBA{B: 255}
			if x%2 == 0 && y%2 == 0 {
				c = color.NRGBA{R: 255, A: 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	child := ctxTestEncode(t, img, "png")
	data, err := rebuildCTXImage([4][]byte{child, child, child, child})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeTileImage(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []image.Point{{0, 0}, {255, 255}, {256, 256}, {511, 511}} {
		got := color.NRGBAModel.Convert(decoded.At(p.X, p.Y)).(color.NRGBA)
		if got != (color.NRGBA{R: 255, A: 64}) {
			t.Fatalf("pixel %v = %v, want red with quarter alpha", p, got)
		}
	}
	// An opaque checkerboard must average to gray rather than select a sample.
	for y := 0; y < ctxTileSize; y++ {
		for x := 0; x < ctxTileSize; x++ {
			v := uint8(0)
			if (x+y)%2 == 0 {
				v = 255
			}
			img.SetNRGBA(x, y, color.NRGBA{R: v, G: v, B: v, A: 255})
		}
	}
	child = ctxTestEncode(t, img, "png")
	data, err = rebuildCTXImage([4][]byte{child, child, child, child})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err = decodeTileImage(data)
	if err != nil {
		t.Fatal(err)
	}
	if got := color.RGBAModel.Convert(decoded.At(128, 128)); got != (color.RGBA{128, 128, 128, 255}) {
		t.Fatalf("checkerboard average = %v", got)
	}
	if _, err := rebuildCTXImage([4][]byte{child, child, child, child[:len(child)-40]}); err == nil {
		t.Fatal("rebuilt a parent with a corrupt child")
	}
}
