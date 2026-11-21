fn main() {
    // 前端产物是内嵌资源的输入。不声明的话，只改界面时 cargo 不会重跑本脚本，
    // 打出来的包仍是上一版界面。
    println!("cargo:rerun-if-changed=../dist");
    tauri_build::build()
}
