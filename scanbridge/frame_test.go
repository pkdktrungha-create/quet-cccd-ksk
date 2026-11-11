package main

import "testing"

func TestFramerUTF8WithCR(t *testing.T) {
	q := "020194009981|082259735|Nguyễn Thị Thủy|06041994|Nữ|An Tiến, An Lư, Thủy Nguyên, Hải Phòng|03062021"
	f := &framer{}
	raw := []byte(q + "\r")
	// chia nhỏ ở giữa một ký tự nhiều byte
	var got []string
	for i := 0; i < len(raw); i += 7 {
		j := i + 7
		if j > len(raw) {
			j = len(raw)
		}
		got = append(got, f.feed(raw[i:j])...)
	}
	if len(got) != 1 || got[0] != q {
		t.Fatalf("got %q", got)
	}
	if f.pending() {
		t.Fatal("còn dữ liệu treo")
	}
}

func TestFramerNoSuffix(t *testing.T) {
	f := &framer{}
	if r := f.feed([]byte("abc|def")); len(r) != 0 {
		t.Fatal("không được chốt khi chưa có CR")
	}
	if !f.pending() || f.flush() != "abc|def" {
		t.Fatal("flush sai")
	}
}

func TestFramerTwoScansAndLatin1(t *testing.T) {
	f := &framer{}
	r := f.feed([]byte("a|b\r\nc|d\r\n"))
	if len(r) != 2 || r[0] != "a|b" || r[1] != "c|d" {
		t.Fatalf("got %q", r)
	}
	if s := cleanScan(decodeScan([]byte{0x4e, 0xe1})); s != "Ná" {
		t.Fatalf("latin1 %q", s)
	}
}
