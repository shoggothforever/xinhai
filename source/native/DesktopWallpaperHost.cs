// Windows desktop host for our own Electron wallpaper window. This helper never
// injects code into Explorer or changes the user's configured static wallpaper.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class DesktopWallpaperHost
{
    private static volatile bool running = true;
    private const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
    private const long WS_CHILD = 0x40000000L, WS_POPUP = 0x80000000L;
    private const long WS_CAPTION = 0x00C00000L, WS_THICKFRAME = 0x00040000L;
    private const long WS_EX_LAYERED = 0x00080000L, WS_EX_NOREDIRECTIONBITMAP = 0x00200000L;
    private const long WS_EX_NOACTIVATE = 0x08000000L, WS_EX_TOOLWINDOW = 0x80L, WS_EX_APPWINDOW = 0x40000L;
    private const uint SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20, SWP_SHOWWINDOW = 0x40;

    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
    private sealed class Desktop { public IntPtr Parent, Icons; public bool Raised; }
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr param);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] private static extern int MapWindowPoints(IntPtr from, IntPtr to, ref POINT point, uint count);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr GetWindowLongPtr64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] private static extern IntPtr SetWindowLongPtr64(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)] private static extern int SetWindowLong32(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint color, byte alpha, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(POINT point, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll")] private static extern int GetWindowRgn(IntPtr window, IntPtr region);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] private static extern bool PtInRegion(IntPtr region, int x, int y);
    [DllImport("gdi32.dll")] private static extern int GetRgnBox(IntPtr region, out RECT rect);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
    [DllImport("user32.dll")] private static extern IntPtr ChildWindowFromPointEx(IntPtr parent, POINT point, uint flags);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    private static long Style(IntPtr hwnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hwnd, index).ToInt64() : (uint)GetWindowLong32(hwnd, index); }
    private static void SetStyle(IntPtr hwnd, int index, long value)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(hwnd, index, new IntPtr(value));
        else SetWindowLong32(hwnd, index, unchecked((int)value));
    }
    private static string WindowClass(IntPtr hwnd) { var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity); return name.ToString(); }
    private static string Escape(string text) { return text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }
    private static void Emit(string json) { Console.WriteLine(json); Console.Out.Flush(); }
    private static RECT MonitorBounds(POINT? anchor)
    {
        var info = new MONITORINFO(); info.Size = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(anchor.HasValue ? MonitorFromPoint(anchor.Value, 2) : MonitorFromWindow(IntPtr.Zero, 1), ref info)) throw new Win32Exception();
        return info.Monitor;
    }
    private static Desktop FindDesktop(bool create)
    {
        var progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) throw new Exception("Windows desktop is unavailable");
        if (create) { IntPtr result; SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 2, 1000, out result); }
        bool raised = (Style(progman, GWL_EXSTYLE) & WS_EX_NOREDIRECTIONBITMAP) != 0;
        var desktop = new Desktop(); desktop.Raised = raised;
        if (raised)
        {
            desktop.Parent = progman;
            desktop.Icons = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (desktop.Icons != IntPtr.Zero && FindWindowEx(progman, IntPtr.Zero, "WorkerW", null) != IntPtr.Zero) return desktop;
        }
        else
        {
            EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
                var icons = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (icons == IntPtr.Zero) return true;
                var worker = FindWindowEx(IntPtr.Zero, hwnd, "WorkerW", null);
                if (worker == IntPtr.Zero) return true;
                desktop.Parent = worker; desktop.Icons = icons; return false;
            }, IntPtr.Zero);
            if (desktop.Parent != IntPtr.Zero) return desktop;
        }
        throw new Exception("Cannot locate a desktop layer behind the icons");
    }
    private static void Attach(IntPtr window, Desktop desktop, RECT bounds, bool interactive)
    {
        var parent = interactive ? desktop.Icons : desktop.Parent;
        if (parent == IntPtr.Zero) throw new Exception("Desktop icon host is unavailable");
        SetStyle(window, GWL_STYLE, (Style(window, GWL_STYLE) | WS_CHILD) & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME));
        var exStyle = (Style(window, GWL_EXSTYLE) | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW;
        if (desktop.Raised) exStyle |= WS_EX_LAYERED;
        SetStyle(window, GWL_EXSTYLE, exStyle);
        SetLastError(0);
        var previous = SetParent(window, parent);
        if (previous == IntPtr.Zero && Marshal.GetLastWin32Error() != 0) throw new Win32Exception();
        if (desktop.Raised && !interactive && !SetLayeredWindowAttributes(window, 0, 255, 2)) throw new Win32Exception();
        var point = new POINT(); point.X = bounds.Left; point.Y = bounds.Top;
        MapWindowPoints(IntPtr.Zero, parent, ref point, 1);
        // In the raised desktop layout the icon view and our window are siblings.
        var after = interactive ? IntPtr.Zero : desktop.Raised ? desktop.Icons : new IntPtr(1);
        if (!SetWindowPos(window, after, point.X, point.Y, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW)) throw new Win32Exception();
        if (GetParent(window) != parent) throw new Exception("Desktop attachment was not retained");
        Emit("{\"event\":\"attached\",\"parent\":\"" + parent.ToInt64() + "\",\"icons\":\"" + desktop.Icons.ToInt64() + "\",\"raised\":" + (desktop.Raised ? "true" : "false") + ",\"width\":" + (bounds.Right - bounds.Left) + ",\"height\":" + (bounds.Bottom - bounds.Top) + "}");
    }
    private static bool Fullscreen(IntPtr wallpaper, Desktop desktop, RECT monitor)
    {
        var foreground = GetForegroundWindow(); RECT rect;
        if (foreground == IntPtr.Zero || foreground == wallpaper || foreground == desktop.Parent || foreground == desktop.Icons || !IsWindowVisible(foreground)) return false;
        string cls = WindowClass(foreground);
        if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "SHELLDLL_DefView") return false;
        return GetWindowRect(foreground, out rect) && rect.Left <= monitor.Left && rect.Top <= monitor.Top && rect.Right >= monitor.Right && rect.Bottom >= monitor.Bottom;
    }
    private static int Main(string[] args)
    {
        try
        {
            // Coordinates passed to Explorer must be physical pixels, including
            // when Electron and Explorer use different per-monitor DPI contexts.
            try { SetThreadDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
            if (args.Length == 2 && args[0] == "--inspect")
            {
                var inspect = new IntPtr(long.Parse(args[1])); RECT rect; GetWindowRect(inspect, out rect);
                Emit("{\"exists\":" + (IsWindow(inspect) ? "true" : "false") + ",\"parent\":\"" + GetParent(inspect).ToInt64() + "\",\"parentClass\":\"" + Escape(WindowClass(GetParent(inspect))) + "\",\"x\":" + rect.Left + ",\"y\":" + rect.Top + ",\"width\":" + (rect.Right - rect.Left) + ",\"height\":" + (rect.Bottom - rect.Top) + "}");
                return 0;
            }
            if (args.Length == 3 && args[0] == "--hit-test")
            {
                var point = new POINT(); point.X = int.Parse(args[1]); point.Y = int.Parse(args[2]);
                var hit = WindowFromPoint(point); uint process; GetWindowThreadProcessId(hit, out process);
                Emit("{\"window\":\"" + hit.ToInt64() + "\",\"class\":\"" + Escape(WindowClass(hit)) + "\",\"process\":" + process + "}"); return 0;
            }
            if ((args.Length == 2 || args.Length == 4) && args[0] == "--inspect-input")
            {
                var inspect = new IntPtr(long.Parse(args[1])); var regionHandle = CreateRectRgn(0, 0, 0, 0);
                try {
                    RECT rect, inputRegion; GetWindowRect(inspect, out rect); int kind = GetWindowRgn(inspect, regionHandle); GetRgnBox(regionHandle, out inputRegion);
                    var point = new POINT(); point.X = (inputRegion.Left + inputRegion.Right) / 2; point.Y = (inputRegion.Top + inputRegion.Bottom) / 2;
                    if (args.Length == 4) {point.X = int.Parse(args[2]); point.Y = int.Parse(args[3]);}
                    var parent = GetParent(inspect); MapWindowPoints(inspect, parent, ref point, 1);
                    var child = ChildWindowFromPointEx(parent, point, 7);
                    MapWindowPoints(parent, IntPtr.Zero, ref point, 1); var hit = WindowFromPoint(point);
                    IntPtr hitResult, activationResult;
                    SendMessageTimeout(inspect, 0x0084, IntPtr.Zero, new IntPtr((point.Y << 16) | (point.X & 0xffff)), 2, 1000, out hitResult);
                    SendMessageTimeout(inspect, 0x0021, GetAncestor(inspect, 2), new IntPtr(1 | (0x0201 << 16)), 2, 1000, out activationResult);
                    Emit("{\"style\":" + Style(inspect, GWL_STYLE) + ",\"exStyle\":" + Style(inspect, GWL_EXSTYLE) + ",\"hitTest\":" + hitResult.ToInt64() + ",\"mouseActivate\":" + activationResult.ToInt64() + ",\"visible\":" + (IsWindowVisible(inspect) ? "true" : "false") + ",\"enabled\":" + (IsWindowEnabled(inspect) ? "true" : "false") + ",\"regionKind\":" + kind + ",\"screenX\":" + point.X + ",\"screenY\":" + point.Y + ",\"desktopHit\":\"" + child.ToInt64() + "\",\"desktopHitClass\":\"" + Escape(WindowClass(child)) + "\",\"foregroundHit\":\"" + hit.ToInt64() + "\",\"foregroundHitClass\":\"" + Escape(WindowClass(hit)) + "\",\"x\":" + rect.Left + ",\"y\":" + rect.Top + ",\"width\":" + (rect.Right - rect.Left) + ",\"height\":" + (rect.Bottom - rect.Top) + "}");
                } finally { DeleteObject(regionHandle); }
                return 0;
            }
            if (args.Length == 4 && args[0] == "--region-test")
            {
                var regionHandle = CreateRectRgn(0, 0, 0, 0);
                try {
                    int kind = GetWindowRgn(new IntPtr(long.Parse(args[1])), regionHandle);
                    Emit("{\"kind\":" + kind + ",\"inside\":" + (PtInRegion(regionHandle, int.Parse(args[2]), int.Parse(args[3])) ? "true" : "false") + "}");
                } finally { DeleteObject(regionHandle); }
                return 0;
            }
            bool interactive = args.Length == 8 && args[1] == "--interactive";
            if (args.Length != 1 && !interactive) throw new Exception("Expected the wallpaper window handle");
            POINT? anchor = null; int[] region = null;
            if (interactive)
            {
                var point = new POINT(); point.X = int.Parse(args[2]); point.Y = int.Parse(args[3]); anchor = point;
                region = new int[] { int.Parse(args[4]), int.Parse(args[5]), int.Parse(args[6]), int.Parse(args[7]) };
                if (region[0] < 0 || region[1] < 0 || region[2] < 1000 || region[3] < 1000 || region[0] + region[2] > 10000 || region[1] + region[3] > 10000) throw new Exception("Invalid cover wall region");
            }
            var window = new IntPtr(long.Parse(args[0]));
            if (!IsWindow(window)) throw new Exception("Wallpaper window does not exist");
            var reader = new Thread(delegate() { while (Console.ReadLine() != null) { } running = false; }); reader.IsBackground = true; reader.Start();
            Desktop desktop = null; RECT lastBounds = new RECT(); bool? paused = null;
            var recovery = new Stopwatch();
            while (running && IsWindow(window))
            {
                try
                {
                    Desktop next;
                    try { next = FindDesktop(desktop == null); }
                    catch { next = FindDesktop(true); }
                    var monitor = MonitorBounds(anchor); var bounds = monitor;
                    if (interactive)
                    {
                        int width = monitor.Right - monitor.Left, height = monitor.Bottom - monitor.Top;
                        bounds.Left += width * region[0] / 10000; bounds.Top += height * region[1] / 10000;
                        bounds.Right = bounds.Left + width * region[2] / 10000; bounds.Bottom = bounds.Top + height * region[3] / 10000;
                    }
                    if (desktop == null || next.Parent != desktop.Parent || next.Icons != desktop.Icons || GetParent(window) != (interactive ? next.Icons : next.Parent) || !bounds.Equals(lastBounds))
                    { Attach(window, next, bounds, interactive); lastBounds = bounds; }
                    if (interactive) SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0, SWP_NOACTIVATE | 0x01 | 0x02);
                    desktop = next; recovery.Reset();
                    bool nowPaused = Fullscreen(window, desktop, monitor);
                    if (paused != nowPaused) { paused = nowPaused; Emit("{\"event\":\"pause\",\"paused\":" + (nowPaused ? "true" : "false") + "}"); }
                }
                catch (Exception error)
                {
                    if (!recovery.IsRunning) { recovery.Start(); Emit("{\"event\":\"recovering\"}"); }
                    if (recovery.ElapsedMilliseconds > 10000) throw new Exception("Desktop recovery failed: " + error.Message);
                }
                Thread.Sleep(500);
            }
            if (running && !IsWindow(window)) Emit("{\"event\":\"window-lost\"}");
            return 0;
        }
        catch (Exception error) { Emit("{\"event\":\"error\",\"message\":\"" + Escape(error.Message) + "\"}"); return 1; }
    }
}
