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

#[cfg(all(test, unix))]
mod helper_tests {
    use super::audio;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};

    fn temp_dir(tag: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "bilimusic-download-{tag}-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_helper(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("yt-dlp");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn 下载助手返回的文件路径能被认出来() {
        let dir = temp_dir("ok");
        let helper = fake_helper(
            &dir,
            "printf 'audio' > '晴天 [BV1xx411c7mD].m4a'\nprintf '%s\\n' '\"晴天 [BV1xx411c7mD].m4a\"'",
        );
        let path = audio(&helper, &dir, "https://example.com/BV1xx411c7mD").unwrap();
        assert_eq!(
            path.file_name().and_then(|n| n.to_str()),
            Some("晴天 [BV1xx411c7mD].m4a")
        );
        assert!(path.is_file());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 下载失败会带上助手输出() {
        let dir = temp_dir("fail");
        let helper = fake_helper(&dir, "echo 'HTTP 403' >&2\nexit 1");
        let err = audio(&helper, &dir, "https://example.com/BV1xx411c7mD").unwrap_err();
        let message = err.to_string();
        assert!(message.contains("HTTP 403"), "失败原因要可读：{message}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
