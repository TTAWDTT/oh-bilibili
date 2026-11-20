use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
const HELPER_NAME: &str = "yt-dlp.exe";
#[cfg(not(windows))]
const HELPER_NAME: &str = "yt-dlp";

pub fn find_helper() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        let dir = exe.parent()?;
        let bundled = [
            dir.to_path_buf(),
            dir.join("resources"),
            dir.join("../Resources"),
        ];
        if let Some(helper) = find_in(bundled) {
            return Some(helper);
        }
    }

    #[cfg(debug_assertions)]
    if let Some(helper) = find_in([Path::new(env!("CARGO_MANIFEST_DIR")).join("../../resources")]) {
        return Some(helper);
    }

    find_in(std::env::split_paths(&std::env::var_os("PATH")?).filter(|path| path.is_absolute()))
}

fn find_in(dirs: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    dirs.into_iter()
        .map(|dir| dir.join(HELPER_NAME))
        .find(|path| path.is_file())
}

pub fn audio(helper: &Path, dir: &Path, url: &str) -> io::Result<PathBuf> {
    let mut command = Command::new(helper);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .current_dir(dir)
        .args(["--no-playlist", "-f", "ba", "--encoding", "utf-8"])
        .args(["--print", "after_move:%(filepath)j", "-P", "."])
        .args(["-o", "%(title)s [%(id)s].%(ext)s", "--", url])
        .output()?;
    if !output.status.success() {
        let reason: String = String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(400)
            .collect();
        return Err(io::Error::other(format!(
            "yt-dlp {}: {}",
            output.status,
            reason.trim()
        )));
    }

    let output_path = output
        .stdout
        .split(|&byte| byte == b'\n')
        .rev()
        .find_map(|line| {
            let name: PathBuf = serde_json::from_slice(line).ok()?;
            let path = dir.join(name);
            (path.parent() == Some(dir) && path.is_file()).then_some(path)
        });
    output_path.ok_or_else(|| io::Error::other("yt-dlp 未返回下载文件"))
}
