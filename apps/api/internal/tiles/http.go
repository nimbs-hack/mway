package tiles

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// NewClient keeps connections between tile bursts as the camera moves. The
// default transport retains only two idle connections per upstream host.
func NewClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = 128
	transport.MaxIdleConnsPerHost = 32
	return &http.Client{Transport: transport}
}

// ParseCoordinate rejects signs, leading zeros and values outside the tile grid.
func ParseCoordinate(value string, max int) (int, error) {
	if value == "" || len(value) > 1 && value[0] == '0' {
		return 0, fmt.Errorf("invalid coordinate")
	}
	for _, c := range value {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("invalid coordinate")
		}
	}
	n, err := strconv.Atoi(value)
	if err != nil || n > max {
		return 0, fmt.Errorf("invalid coordinate")
	}
	return n, nil
}

// Fetch bounds both transfer time and response size, including chunked responses.
func Fetch(ctx context.Context, client *http.Client, url string, maxBytes int) ([]byte, http.Header, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, nil, err
	}
	response, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("upstream returned %d", response.StatusCode)
	}
	if response.ContentLength > int64(maxBytes) {
		return nil, nil, fmt.Errorf("upstream response too large")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, int64(maxBytes)+1))
	if err != nil {
		return nil, nil, err
	}
	if len(data) > maxBytes {
		return nil, nil, fmt.Errorf("upstream response too large")
	}
	return data, response.Header, nil
}
