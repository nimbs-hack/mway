package tiles

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
)

const ctxTileSize = 512

// tileImageType checks dimensions without allocating a decoded image.
// Call validateTileImage before accepting bytes from upstream or disk.
func tileImageType(data []byte) string {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width != ctxTileSize || config.Height != ctxTileSize {
		return ""
	}
	switch format {
	case "png":
		return "image/png"
	case "jpeg":
		return "image/jpeg"
	default:
		return ""
	}
}

func decodeTileImage(data []byte) (image.Image, error) {
	switch tileImageType(data) {
	case "image/png":
		return png.Decode(bytes.NewReader(data))
	case "image/jpeg":
		return jpeg.Decode(bytes.NewReader(data))
	default:
		return nil, fmt.Errorf("invalid tile image format or dimensions")
	}
}

// Validate every pixel, but cache and serve the original encoded bytes.
func validateTileImage(data []byte) error {
	_, err := decodeTileImage(data)
	return err
}

// Each child occupies one quadrant, ordered top-left, top-right, bottom-left,
// bottom-right. Averaging each 2x2 area gives an exact half-size reduction.
// RGBA returns premultiplied channels, so transparent pixels average correctly.
func rebuildCTXImage(children [4][]byte) ([]byte, error) {
	result := image.NewRGBA(image.Rect(0, 0, ctxTileSize, ctxTileSize))
	const half = ctxTileSize / 2
	for quadrant, data := range children {
		child, err := decodeTileImage(data)
		if err != nil {
			return nil, err
		}
		for y := 0; y < half; y++ {
			for x := 0; x < half; x++ {
				var red, green, blue, alpha uint32
				for dy := 0; dy < 2; dy++ {
					for dx := 0; dx < 2; dx++ {
						r, g, b, a := child.At(x*2+dx, y*2+dy).RGBA()
						red += r
						green += g
						blue += b
						alpha += a
					}
				}
				// Divide four 16-bit samples by 4*257 and round to 8 bits.
				result.SetRGBA(x+(quadrant%2)*half, y+(quadrant/2)*half, color.RGBA{
					R: uint8((red + 514) / 1028),
					G: uint8((green + 514) / 1028),
					B: uint8((blue + 514) / 1028),
					A: uint8((alpha + 514) / 1028),
				})
			}
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, result); err != nil {
		return nil, err
	}
	return encoded.Bytes(), nil
}
