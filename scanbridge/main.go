//go:build windows

package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

var (
	k32              = syscall.NewLazyDLL("kernel32.dll")
	u32              = syscall.NewLazyDLL("user32.dll")
	pGetCommState    = k32.NewProc("GetCommState")
	pSetCommState    = k32.NewProc("SetCommState")
	pSetCommTimeouts = k32.NewProc("SetCommTimeouts")
	pEscapeCommFunc  = k32.NewProc("EscapeCommFunction")
	pCreateMutexW    = k32.NewProc("CreateMutexW")
	pSendInput       = u32.NewProc("SendInput")
	pOpenClipboard   = u32.NewProc("OpenClipboard")
	pCloseClipboard  = u32.NewProc("CloseClipboard")
	pEmptyClipboard  = u32.NewProc("EmptyClipboard")
	pSetClipboardDat = u32.NewProc("SetClipboardData")
	pGetClipboardDat = u32.NewProc("GetClipboardData")
	pGlobalAlloc     = k32.NewProc("GlobalAlloc")
	pGlobalLock      = k32.NewProc("GlobalLock")
	pGlobalUnlock    = k32.NewProc("GlobalUnlock")
)

const (
	inputKeyboard   = 1
	keyeventfKeyUp  = 0x0002
	keyeventfUnicod = 0x0004
	vkReturn        = 0x0D
	setDTR          = 5
	setRTS          = 3
	errAlreadyExist = 183
)

// INPUT (kiểu bàn phím) trên Windows 64 bit dài 40 byte.
type kbInput struct {
	typ         uint32
	_           uint32
	wVk         uint16
	wScan       uint16
	dwFlags     uint32
	time        uint32
	_           uint32
	dwExtraInfo uintptr
	_           [8]byte
}

type dcb struct {
	DCBlength  uint32
	BaudRate   uint32
	Flags      uint32
	WReserved  uint16
	XonLim     uint16
	XoffLim    uint16
	ByteSize   byte
	Parity     byte
	StopBits   byte
	XonChar    int8
	XoffChar   int8
	ErrorChar  int8
	EofChar    int8
	EvtChar    int8
	WReserved1 uint16
}

type commTimeouts struct {
	ReadIntervalTimeout         uint32
	ReadTotalTimeoutMultiplier  uint32
	ReadTotalTimeoutConstant    uint32
	WriteTotalTimeoutMultiplier uint32
	WriteTotalTimeoutConstant   uint32
}

var (
	typeMu    sync.Mutex
	sendEnter bool
	usePaste  bool
	baud      uint
)

const (
	cfUnicodeText = 13
	gmemMoveable  = 0x0002
	vkControl     = 0x11
	vkV           = 0x56
)

func openClipboard() bool {
	for i := 0; i < 10; i++ {
		if r, _, _ := pOpenClipboard.Call(0); r != 0 {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

// getClipboardText đọc chữ đang có trong clipboard (để trả lại sau khi dán).
func getClipboardText() (string, bool) {
	if !openClipboard() {
		return "", false
	}
	defer pCloseClipboard.Call()
	h, _, _ := pGetClipboardDat.Call(cfUnicodeText)
	if h == 0 {
		return "", false
	}
	p, _, _ := pGlobalLock.Call(h)
	if p == 0 {
		return "", false
	}
	defer pGlobalUnlock.Call(h)
	var u []uint16
	for i := 0; i < 1<<20; i++ {
		c := *(*uint16)(unsafe.Pointer(p + uintptr(i)*2))
		if c == 0 {
			break
		}
		u = append(u, c)
	}
	return string(utf16.Decode(u)), true
}

func setClipboardText(s string) bool {
	u := utf16.Encode([]rune(s))
	u = append(u, 0)
	size := uintptr(len(u) * 2)
	h, _, _ := pGlobalAlloc.Call(gmemMoveable, size)
	if h == 0 {
		return false
	}
	p, _, _ := pGlobalLock.Call(h)
	if p == 0 {
		return false
	}
	for i, c := range u {
		*(*uint16)(unsafe.Pointer(p + uintptr(i)*2)) = c
	}
	pGlobalUnlock.Call(h)
	if !openClipboard() {
		return false
	}
	defer pCloseClipboard.Call()
	pEmptyClipboard.Call()
	r, _, _ := pSetClipboardDat.Call(cfUnicodeText, h)
	return r != 0
}

func pressCtrlV() {
	in := []kbInput{
		{typ: inputKeyboard, wVk: vkControl},
		{typ: inputKeyboard, wVk: vkV},
		{typ: inputKeyboard, wVk: vkV, dwFlags: keyeventfKeyUp},
		{typ: inputKeyboard, wVk: vkControl, dwFlags: keyeventfKeyUp},
	}
	pSendInput.Call(uintptr(len(in)), uintptr(unsafe.Pointer(&in[0])), unsafe.Sizeof(in[0]))
}

// pasteText đưa chuỗi vào clipboard rồi nhấn Ctrl+V: không đi qua bộ gõ (EVKey/Unikey) nên không bị đổi bảng mã.
func pasteText(s string) bool {
	old, had := getClipboardText()
	if !setClipboardText(s) {
		return false
	}
	time.Sleep(30 * time.Millisecond)
	pressCtrlV()
	time.Sleep(250 * time.Millisecond)
	if had {
		setClipboardText(old)
	}
	return true
}

func logf(format string, a ...interface{}) {
	fmt.Printf(time.Now().Format("15:04:05")+"  "+format+"\n", a...)
}

func sendUnits(units []uint16) {
	in := make([]kbInput, 0, len(units)*2)
	for _, u := range units {
		in = append(in, kbInput{typ: inputKeyboard, wScan: u, dwFlags: keyeventfUnicod})
		in = append(in, kbInput{typ: inputKeyboard, wScan: u, dwFlags: keyeventfUnicod | keyeventfKeyUp})
	}
	if len(in) == 0 {
		return
	}
	pSendInput.Call(uintptr(len(in)), uintptr(unsafe.Pointer(&in[0])), unsafe.Sizeof(in[0]))
}

func pressEnter() {
	in := []kbInput{
		{typ: inputKeyboard, wVk: vkReturn},
		{typ: inputKeyboard, wVk: vkReturn, dwFlags: keyeventfKeyUp},
	}
	pSendInput.Call(2, uintptr(unsafe.Pointer(&in[0])), unsafe.Sizeof(in[0]))
}

// typeText gõ chuỗi vào cửa sổ đang giữ con trỏ, giống một bàn phím nhưng gửi được mọi chữ Unicode.
func typeText(s string) {
	typeMu.Lock()
	defer typeMu.Unlock()
	if usePaste {
		if pasteText(s) {
			if sendEnter {
				time.Sleep(20 * time.Millisecond)
				pressEnter()
			}
			return
		}
		logf("Không dán được qua clipboard, chuyển sang gõ từng ký tự.")
	}
	u := utf16.Encode([]rune(s))
	for i := 0; i < len(u); i += 8 {
		j := i + 8
		if j > len(u) {
			j = len(u)
		}
		// không cắt đôi một cặp thay thế (ký tự ngoài BMP)
		if j < len(u) && u[j-1] >= 0xD800 && u[j-1] <= 0xDBFF {
			j++
		}
		sendUnits(u[i:j])
		time.Sleep(2 * time.Millisecond)
		i = j - 8
	}
	if sendEnter {
		time.Sleep(20 * time.Millisecond)
		pressEnter()
	}
}

func listPorts() []string {
	cmd := exec.Command("reg", "query", `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM`)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	re := regexp.MustCompile(`COM\d+`)
	seen := map[string]bool{}
	var res []string
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, "REG_SZ") {
			continue
		}
		if m := re.FindString(line); m != "" && !seen[m] {
			seen[m] = true
			res = append(res, m)
		}
	}
	return res
}

func openPort(name string) (syscall.Handle, error) {
	p, err := syscall.UTF16PtrFromString(`\\.\` + name)
	if err != nil {
		return 0, err
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_EXISTING, 0, 0)
	if err != nil {
		return 0, err
	}
	var d dcb
	d.DCBlength = uint32(unsafe.Sizeof(d))
	if r, _, _ := pGetCommState.Call(uintptr(h), uintptr(unsafe.Pointer(&d))); r != 0 {
		d.BaudRate = uint32(baud)
		d.ByteSize = 8
		d.Parity = 0
		d.StopBits = 0
		d.Flags = 0x0001 | 0x0010 // fBinary, DTR bật
		pSetCommState.Call(uintptr(h), uintptr(unsafe.Pointer(&d)))
	}
	to := commTimeouts{ReadIntervalTimeout: 0xFFFFFFFF, ReadTotalTimeoutMultiplier: 0xFFFFFFFF, ReadTotalTimeoutConstant: 200}
	pSetCommTimeouts.Call(uintptr(h), uintptr(unsafe.Pointer(&to)))
	pEscapeCommFunc.Call(uintptr(h), setDTR)
	pEscapeCommFunc.Call(uintptr(h), setRTS)
	return h, nil
}

// readLoop đọc một cổng cho tới khi rút máy quét hoặc lỗi.
func readLoop(name string, h syscall.Handle) {
	defer syscall.CloseHandle(h)
	f := &framer{}
	buf := make([]byte, 512)
	last := time.Now()
	emit := func(s string) {
		logf("Đã nhận một lần quét (%d ký tự) từ %s", len([]rune(s)), name)
		typeText(s)
	}
	for {
		var n uint32
		err := syscall.ReadFile(h, buf, &n, nil)
		if err != nil {
			logf("Cổng %s đã ngắt: %v", name, err)
			return
		}
		if n > 0 {
			last = time.Now()
			for _, s := range f.feed(buf[:n]) {
				emit(s)
			}
			continue
		}
		if f.pending() && time.Since(last) > 120*time.Millisecond {
			if s := f.flush(); s != "" {
				emit(s)
			}
		}
	}
}

func main() {
	port := flag.String("port", "", "chỉ dùng cổng này (ví dụ COM5); để trống = tự tìm mọi cổng COM")
	flag.UintVar(&baud, "baud", 9600, "tốc độ cổng COM")
	flag.BoolVar(&sendEnter, "enter", false, "gõ thêm phím Enter sau mỗi lần quét")
	flag.BoolVar(&usePaste, "paste", false, "dán bằng Ctrl+V thay vì gõ từng ký tự (không phụ thuộc EVKey/Unikey)")
	flag.Parse()

	name, _ := syscall.UTF16PtrFromString("Global\\ScanBridge_QuetCCCD")
	_, _, e := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if errno, ok := e.(syscall.Errno); ok && errno == errAlreadyExist {
		fmt.Println("ScanBridge đã chạy rồi (xem cửa sổ đang thu nhỏ ở thanh taskbar). Thoát.")
		time.Sleep(4 * time.Second)
		os.Exit(0)
	}

	fmt.Println("=== ScanBridge: máy quét COM -> gõ chữ có dấu vào cửa sổ đang chọn ===")
	fmt.Println("Để cửa sổ này chạy (có thể thu nhỏ). Đóng cửa sổ = dừng.")
	fmt.Println("Nội dung thẻ không được lưu lại, cũng không in ra màn hình.")

	var mu sync.Mutex
	active := map[string]bool{}
	warned := map[string]bool{}
	noPortShown := false
	for {
		ports := listPorts()
		if *port != "" {
			ports = []string{strings.ToUpper(*port)}
		}
		if len(ports) == 0 && !noPortShown {
			logf("Chưa thấy cổng COM nào. Máy quét cần ở chế độ USB Serial. Đang chờ…")
			noPortShown = true
		}
		if len(ports) > 0 {
			noPortShown = false
		}
		for _, p := range ports {
			mu.Lock()
			busy := active[p]
			mu.Unlock()
			if busy {
				continue
			}
			h, err := openPort(p)
			if err != nil {
				if !warned[p] {
					logf("Chưa mở được %s (%v). Nếu là máy quét: đóng chương trình khác đang giữ cổng này (nút \"Nối máy quét qua cổng COM\" trong phần mềm giấy khám).", p, err)
					warned[p] = true
				}
				continue
			}
			warned[p] = false
			logf("Đã nối cổng %s. Quét thẻ là chữ được gõ vào ô đang chọn.", p)
			mu.Lock()
			active[p] = true
			mu.Unlock()
			go func(p string, h syscall.Handle) {
				readLoop(p, h)
				mu.Lock()
				active[p] = false
				mu.Unlock()
			}(p, h)
		}
		time.Sleep(2 * time.Second)
	}
}
