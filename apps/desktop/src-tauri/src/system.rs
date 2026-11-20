#[cfg(windows)]
pub use windows::{open, reveal};

#[cfg(windows)]
mod windows {
    use std::ffi::OsStr;
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
        COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::UI::Shell::{
        SHOpenFolderAndSelectItems, SHParseDisplayName, ShellExecuteW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    pub fn open(target: &OsStr) -> io::Result<()> {
        let target: Vec<u16> = target.encode_wide().chain([0]).collect();
        with_com(|| {
            // The NUL-terminated UTF-16 target stays alive for the Shell call.
            let status = unsafe {
                ShellExecuteW(
                    null_mut(),
                    null(),
                    target.as_ptr(),
                    null(),
                    null(),
                    SW_SHOWNORMAL,
                )
            } as isize;
            if status <= 32 {
                return Err(io::Error::other(format!("ShellExecuteW: {status}")));
            }
            Ok(())
        })
    }

    pub fn reveal(path: &Path) -> io::Result<()> {
        let path: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        with_com(|| {
            let mut item = null_mut();
            // The Shell owns the item allocation format. Free it after the selection call.
            unsafe {
                let status =
                    SHParseDisplayName(path.as_ptr(), null_mut(), &mut item, 0, null_mut());
                check_hresult("SHParseDisplayName", status)?;
                let status = SHOpenFolderAndSelectItems(item, 0, null(), 0);
                CoTaskMemFree(item.cast());
                check_hresult("SHOpenFolderAndSelectItems", status)
            }
        })
    }

    fn with_com(action: impl FnOnce() -> io::Result<()>) -> io::Result<()> {
        let mode = (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32;
        // Balance successful COM initialization on the calling thread.
        let status = unsafe { CoInitializeEx(null(), mode) };
        check_hresult("CoInitializeEx", status)?;
        let result = action();
        unsafe { CoUninitialize() };
        result
    }

    fn check_hresult(api: &str, status: i32) -> io::Result<()> {
        if status < 0 {
            return Err(io::Error::other(format!("{api}: {status:#010x}")));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn open(target: &std::ffi::OsStr) -> std::io::Result<()> {
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

#[cfg(target_os = "macos")]
pub fn reveal(path: &std::path::Path) -> std::io::Result<()> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn reveal(path: &std::path::Path) -> std::io::Result<()> {
    let folder = path
        .parent()
        .ok_or_else(|| std::io::Error::other("文件路径没有上级目录"))?;
    open(folder.as_os_str())
}
