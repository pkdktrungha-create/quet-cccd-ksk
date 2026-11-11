package main

import (
	"strings"
	"unicode/utf8"
)

// decodeScan đổi các byte nhận từ máy quét thành chuỗi: UTF-8 nếu hợp lệ, ngược lại coi từng byte là Latin-1.
func decodeScan(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

// cleanScan bỏ ký tự xuống dòng, ký tự NUL và khoảng trắng thừa ở hai đầu.
func cleanScan(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == 0 {
			return -1
		}
		return r
	}, s)
	return strings.TrimSpace(s)
}

// framer gom byte rời thành từng lần quét: gặp CR/LF thì chốt ngay, hoặc khi im lặng đủ lâu.
type framer struct {
	buf []byte
}

// feed nhận các byte mới; trả về các lần quét đã đủ (đã kết thúc bằng CR/LF).
func (f *framer) feed(b []byte) []string {
	var out []string
	for _, c := range b {
		if c == '\r' || c == '\n' {
			if s := cleanScan(decodeScan(f.buf)); s != "" {
				out = append(out, s)
			}
			f.buf = f.buf[:0]
			continue
		}
		f.buf = append(f.buf, c)
	}
	return out
}

// flush chốt phần còn lại khi máy quét không gửi CR/LF.
func (f *framer) flush() string {
	s := cleanScan(decodeScan(f.buf))
	f.buf = f.buf[:0]
	return s
}

func (f *framer) pending() bool { return len(f.buf) > 0 }
