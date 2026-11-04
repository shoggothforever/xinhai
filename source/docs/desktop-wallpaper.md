# Windows 桌面壁纸模式

点击窗口右上角常驻的 **桌面壁纸**，即可跳到 **启用桌面壁纸** 按钮。也可在 **10 自定义** 页顶部找到 **Windows 桌面壁纸**；快速定位支持搜索“启用”“嵌入”“桌面壁纸”。当前版本覆盖主显示器，保留桌面图标和右键菜单，不接管鼠标或键盘。

背景、人物、配色和时钟跟随主窗口的外观设置。调整位置仍在原有自定义界面完成。纯壁纸窗口不显示待办、学习导航或播放器；音乐与专注继续由学习主窗口管理。当前版本不在启动时自动启用壁纸，也不增加 Windows 开机启动项。

启用时关闭主窗口会隐藏到托盘；双击托盘恢复，右键可停止壁纸或退出。停止时销毁壁纸窗口，不改写原有 Windows 静态壁纸。全屏前台应用、锁屏或休眠时动态画面回退静帧，恢复后继续显示。Explorer 桌面层重建时重新挂载；原生窗口被销毁时有限次重建，连续失败会停止并显示错误。

## 构建与验证

在 Windows 安装依赖后执行：

```sh
npm run build
npm run typecheck
npm test
npm run test:desktop-wallpaper
npm run dist:desktop
```

`dev` 和 `build` 会调用系统自带的 .NET Framework 4.x C# 编译器，生成 `build/desktop-host/DesktopWallpaperHost.exe`。该生成目录不提交到 Git；打包通过 `extraResources` 将宿主放到应用 `resources/desktop-host`。非 Windows 构建跳过原生宿主，功能入口不显示。

`dist:desktop` 输出可直接运行的 x64 目录 `dist/desktop-x64/win-unpacked/`。仓库根目录的 `启动桌面版.cmd` 优先运行 `dist/desktop-personal-current/win-unpacked/` 中已恢复 P3R 素材的版本，其次使用 `dist/desktop-x64/win-unpacked/`；没有打包时使用已经安装的 Electron 和 `out/` 构建结果。原来的 `dist` 命令仍构建 ia32 安装程序。

原生专项检查在隔离临时资料目录运行，短暂创建实际壁纸窗口，验证桌面父窗口、物理像素尺寸、外观同步、只读 IPC、暂停、窗口丢失后的恢复、停止与重新启用；结束时清理测试窗口。报告和画面位于 `dist/desktop-wallpaper-test/`。不会重启用户的 Explorer、锁屏或改写真实学习资料；这些场景仍需人工验收。

可通过环境变量 `XINHAI_TEST_VIDEO` 指向本机有效的视频文件，附加实际解码、播放及暂停恢复检查；未提供时跳过媒体解码专项。测试不联网、不把该文件复制进源码或发布包。

## 实现边界

- `src/main/desktopWallpaper.ts` 管理独立窗口、托盘、宿主生命周期与暂停原因。
- `native/DesktopWallpaperHost.cs` 使用 Win32 窗口接口，适配传统 WorkerW 与新版 Progman 图层，计算主屏物理尺寸；宿主的标准输入关闭时退出。
- `src/preload/wallpaper.ts` 只提供读取外观和订阅更新。壁纸页面不能访问学习、模型、备份或写入接口；主窗口 IPC 始终核对窗口与顶层页面。
- `src/renderer/src/wallpaper.tsx` 复用显示组件，不挂载学习 App、不启动专注结算、不写入客户端存储，也不重复播放声音。

桌面层级属于 Windows Shell 实现细节，Windows 更新后可能需要兼容调整。尚未提供多屏分别选景、桌面控件点击、壁纸端自动轮换和电池策略。源码只附中性示例，可从本机完整安装版 [恢复 P3R 主题](personal-media.md)；媒体不进入 fork 的 Git 提交。

## 本机验证记录 · 2026-11-03

Windows 11（build 26100）、Electron 33.4.11 x64、主屏 3840×2160：原生挂载到 Progman、物理尺寸、场景像素、外观更新、只读窗口边界、有效 WebM 解码与暂停恢复、模拟窗口销毁后的重建、停止和重新启用均通过。有效视频取自 Mozilla 的 CC0 示例，仅保留在本地 `dist/` 测试目录，没有进入源码或发布包。

真实应用入口中的启用按钮、SQLite 外观设置同步、关闭后隐藏到托盘，以及学习记录/积分不重复写入检查通过。类型检查、13 组纯逻辑回归、11 项实际 SQLite 专项、Android 网页构建和源码范围校验通过。此记录不代表完成真实 Explorer 重启、Win+D、锁屏/睡眠、多显示器或长期耗电验收。
