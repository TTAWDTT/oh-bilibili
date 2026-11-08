//! 依赖方向断言。
//!
//! 架构文档说「依赖方向由 cargo 校验，不由评审意见保证」，这个测试就是那句话的兑现：
//! 谁想偷偷加一条反向依赖，这里会红。

use std::collections::BTreeSet;
use std::process::Command;

fn workspace_edges() -> Vec<(String, BTreeSet<String>)> {
    let output = Command::new(env!("CARGO"))
        .args(["metadata", "--no-deps", "--format-version", "1"])
        .output()
        .expect("跑不动 cargo metadata");
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).expect("cargo metadata 应该是 JSON");
    let packages = value["packages"].as_array().expect("有 packages");

    packages
        .iter()
        .map(|p| {
            let name = p["name"].as_str().unwrap_or_default().to_string();
            let deps = p["dependencies"]
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(|d| d["name"].as_str())
                        .filter(|n| n.starts_with("bilimusic"))
                        .map(|n| n.to_string())
                        .collect()
                })
                .unwrap_or_default();
            (name, deps)
        })
        .collect()
}

fn edges_of(name: &str) -> BTreeSet<String> {
    workspace_edges()
        .into_iter()
        .find(|(n, _)| n == name)
        .map(|(_, d)| d)
        .unwrap_or_default()
}

#[test]
fn 依赖方向与架构文档一致() {
    let allowed: &[(&str, &[&str])] = &[
        ("bilimusic-model", &[]),
        ("bilimusic-bili", &["bilimusic-model"]),
        ("bilimusic-store", &["bilimusic-model"]),
        ("bilimusic-audio", &[]),
        (
            "bilimusic-core",
            &[
                "bilimusic-model",
                "bilimusic-bili",
                "bilimusic-store",
                "bilimusic-audio",
            ],
        ),
        ("bilimusic", &["bilimusic-core", "bilimusic-model"]),
    ];

    for (crate_name, allow) in allowed {
        let actual = edges_of(crate_name);
        for dep in &actual {
            assert!(
                allow.contains(&dep.as_str()),
                "{crate_name} 依赖了 {dep}，但架构图里没有这条边"
            );
        }
    }
}

#[test]
fn 叶子_crate_不认识上层() {
    // 网络层不该知道数据库，音频层不该知道网络。
    assert!(edges_of("bilimusic-bili").is_empty() || {
        let e = edges_of("bilimusic-bili");
        e.iter().all(|d| d == "bilimusic-model")
    });
    assert!(edges_of("bilimusic-audio").is_empty());
    assert!(edges_of("bilimusic-model").is_empty());
}
