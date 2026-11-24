//! UP 主公开名片、空间公告和直播间资料。
use crate::{
    client::{API, LIVE_API},
    error::BiliError,
    Source,
};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

pub(crate) fn image(value: &Value) -> Option<String> {
    text(value).and_then(|url| {
        if let Some(path) = url.strip_prefix("//") {
            Some(format!("https://{path}"))
        } else if url.starts_with("http://") || url.starts_with("https://") {
            Some(url.replacen("http://", "https://", 1))
        } else {
            None
        }
    })
}

fn color(value: &Value) -> Option<String> {
    let hex = value.as_str()?.strip_prefix('#')?;
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    // 粉丝牌传 AARRGGBB，会员昵称传 RRGGBB。
    match hex.len() {
        6 => Some(format!("#{hex}")),
        8 => Some(format!("#{}", &hex[2..])),
        _ => None,
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Nameplate {
    pub name: String,
    pub image: String,
    pub small: Option<String>,
    pub condition: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Membership {
    pub label: Option<String>,
    pub image: Option<String>,
    pub animated: Option<String>,
    pub nickname_color: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuthorDress {
    pub pendant: Option<String>,
    pub pendant_name: Option<String>,
    pub nameplate: Option<Nameplate>,
    pub membership: Option<Membership>,
}

impl AuthorDress {
    pub(crate) fn from_card(card: &Value) -> Self {
        let pendant = &card["pendant"];
        let plate = &card["nameplate"];
        let vip = &card["vip"];
        let label = &vip["label"];
        Self {
            pendant: image(&pendant["image_enhance"]).or_else(|| image(&pendant["image"])),
            pendant_name: text(&pendant["name"]),
            nameplate: image(&plate["image"])
                .or_else(|| image(&plate["image_small"]))
                .map(|url| Nameplate {
                    name: text(&plate["name"]).unwrap_or_else(|| "个人勋章".into()),
                    image: url,
                    small: image(&plate["image_small"]),
                    condition: text(&plate["condition"]),
                }),
            membership: (vip["vipStatus"].as_i64() == Some(1)).then(|| Membership {
                label: text(&label["text"]),
                image: image(&label["img_label_uri_hans_static"]),
                animated: image(&label["img_label_uri_hans"]),
                nickname_color: color(&vip["nickname_color"]),
            }),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SpaceRoom {
    pub id: u64,
    pub title: Option<String>,
    pub cover: Option<String>,
    pub live: bool,
    pub looping: bool,
}

#[derive(Debug, Serialize)]
pub struct FansMedal {
    pub name: String,
    pub level: u64,
    pub background: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Charging {
    pub url: String,
    pub icon: Option<String>,
    pub count: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct SpaceProfile {
    pub official_icon: Option<String>,
    pub fans_medal: Option<FansMedal>,
    pub charging: Option<Charging>,
    pub sex: Option<String>,
    pub birthday: Option<String>,
    pub school: Option<String>,
}

fn profile(data: &Value, privacy: &Value) -> SpaceProfile {
    let medal = &data["fans_medal"];
    let detail = &medal["detail"];
    let fans_medal = || {
        Some(FansMedal {
            name: text(&detail["medal_name"])?,
            level: detail["level"].as_u64()?,
            background: color(&detail["medal_color"]),
            color: color(&detail["medal_color_name"]),
        })
    };
    let elec = &data["elec"]["show_info"];
    let charging = || {
        let url = reqwest::Url::parse(elec["jump_url_web"].as_str()?).ok()?;
        if url.scheme() != "https" || !url.host_str()?.ends_with(".bilibili.com") {
            return None;
        }
        Some(Charging {
            url: url.to_string(),
            icon: image(&elec["icon"]),
            count: if elec["upower_count_show"] == true {
                elec["total"].as_u64()
            } else {
                None
            },
        })
    };
    let public = privacy["user_info"] == 1;
    SpaceProfile {
        official_icon: image(&data["attestation"]["icon"]),
        fans_medal: if medal["show"] == true && medal["wear"] == true {
            fans_medal()
        } else {
            None
        },
        charging: if elec["show"] == true {
            charging()
        } else {
            None
        },
        sex: if public {
            text(&data["sex"]).filter(|s| matches!(s.as_str(), "男" | "女"))
        } else {
            None
        },
        birthday: if public {
            text(&data["birthday"])
                .filter(|s| !matches!(s.as_str(), "0000-00-00" | "00-00"))
        } else {
            None
        },
        school: if public && privacy["disable_show_school"] == 0 {
            text(&data["school"]["name"])
        } else {
            None
        },
    }
}

impl Source {
    pub async fn space_notice(&self, mid: u64) -> Result<Option<String>, BiliError> {
        let v = self
            .client
            .get_json(
                &format!("{API}/x/space/notice?mid={mid}"),
                Duration::from_millis(400),
            )
            .await?;
        Ok(text(&v["data"]))
    }

    pub async fn space_room(&self, mid: u64) -> Result<Option<SpaceRoom>, BiliError> {
        let v = self
            .client
            .get_json(
                &format!("{LIVE_API}/room/v1/Room/getRoomInfoOld?mid={mid}"),
                Duration::from_millis(400),
            )
            .await?;
        let d = &v["data"];
        Ok(d["roomid"]
            .as_u64()
            .filter(|id| *id > 0 && d["roomStatus"] == 1)
            .map(|id| SpaceRoom {
                id,
                title: text(&d["title"]),
                cover: image(&d["cover"]),
                live: d["liveStatus"] == 1,
                looping: d["roundStatus"] == 1,
            }))
    }

    pub async fn space_profile(&self, mid: u64) -> Result<SpaceProfile, BiliError> {
        let settings = self
            .client
            .get_json(
                &format!("{API}/x/space/setting?mid={mid}"),
                Duration::from_millis(400),
            )
            .await;
        let details = self
            .client
            .signed_get(
                &format!("{API}/x/space/wbi/acc/info"),
                vec![("mid", mid.to_string())],
                Duration::from_millis(600),
            )
            .await?;
        let privacy = settings
            .as_ref()
            .map(|v| &v["data"]["privacy"])
            .unwrap_or(&Value::Null);
        Ok(profile(&details["data"], privacy))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn negative_legacy_pendant_id_and_inactive_membership() {
        let card = json!({
            "pendant":{"pid":-338454175,"image":"http://i2.hdslb.com/frame.png","name":"头像挂件"},
            "vip":{"vipStatus":0,"label":{"img_label_uri_hans_static":"https://i0.hdslb.com/inactive.png"}}
        });
        let dress = AuthorDress::from_card(&card);
        assert_eq!(
            dress.pendant.as_deref(),
            Some("https://i2.hdslb.com/frame.png")
        );
        assert!(dress.membership.is_none());
        assert!(dress.nameplate.is_none());
    }

    #[test]
    fn profile_only_exposes_visible_fields() {
        let mut details = json!({
            "sex":"男","birthday":"05-16","school":{"name":"公开学校"},
            "fans_medal":{"show":true,"wear":true,"detail":{"medal_name":"飓风","level":18,"medal_color_name":"#FFAB6890"}},
            "elec":{"show_info":{"show":true,"jump_url_web":"https://member.bilibili.com/mall/upower-pay?mid=946974","upower_count_show":false,"total":1}}
        });
        let public = profile(&details, &json!({"user_info":1,"disable_show_school":0}));
        assert_eq!(public.school.as_deref(), Some("公开学校"));
        assert_eq!(public.birthday.as_deref(), Some("05-16"));
        assert_eq!(public.fans_medal.unwrap().color.as_deref(), Some("#AB6890"));
        assert!(public.charging.unwrap().count.is_none());
        details["fans_medal"]["wear"] = json!(false);
        details["elec"]["show_info"]["show"] = json!(false);
        for privacy in [Value::Null, json!({"user_info":0, "disable_show_school":0})] {
            let hidden = profile(&details, &privacy);
            assert!(hidden.school.is_none() && hidden.sex.is_none() && hidden.birthday.is_none());
            assert!(hidden.charging.is_none() && hidden.fans_medal.is_none());
        }
        assert!(
            profile(&details, &json!({"user_info":1,"disable_show_school":1}))
                .school
                .is_none()
        );
    }
}
