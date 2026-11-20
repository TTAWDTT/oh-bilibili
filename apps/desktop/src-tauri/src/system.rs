use std::{ffi::OsStr, io};

#[cfg(windows)]
pub fn open(target: &OsStr) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let target: Vec<u16> = target.encode_wide().chain([0]).collect();
    let mode = (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32;
    // `target` is alive and NUL-terminated throughout the call. Balance successful COM init.
    let result = unsafe {
        let status = CoInitializeEx(null(), mode);
        if status < 0 {
            return Err(io::Error::other(format!("CoInitializeEx: {status:#010x}")));
        }
        let result = ShellExecuteW(
            null_mut(),
            null(),
            target.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        ) as isize;
        CoUninitialize();
        result
    };
    if result <= 32 {
        return Err(io::Error::other(format!("ShellExecuteW: {result}")));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn open(target: &OsStr) -> io::Result<()> {
    let command = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(command)
        .arg(target)
        .spawn()
        .map(|_| ())
}
