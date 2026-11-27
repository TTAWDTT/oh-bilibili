use bilimusic_core::state::{Queue, WatchAutoplay};
use bilimusic_model::Track;

fn track(key: &str) -> Track {
    serde_json::from_value(serde_json::json!({ "key": key, "title": key, "artist": "" })).unwrap()
}

#[test]
fn listening_inserts_the_remaining_watch_order_without_losing_the_queue() {
    for shuffle in [false, true] {
        let tracks = ["past", "watch", "music", "later"].map(track);
        let mut queue = Queue::from_tracks(&tracks, 1);
        queue.set_shuffle(shuffle);
        let later_id = queue.entry_id_of("later");
        let following = ["episode", "later"].map(track);
        queue.continue_watching(Some(&following), true);
        queue.continue_watching(Some(&following), true);
        assert_eq!(queue.entry_id_of("later"), later_id);
        assert_eq!(queue.items().iter().map(|t| t.key.as_opaque()).collect::<Vec<_>>(),
                   ["past", "watch", "episode", "later", "music"]);
        assert_eq!(queue.current().unwrap().watch_autoplay, Some(WatchAutoplay::Next));
        assert_eq!(queue.advance(false).unwrap().track.key.as_opaque(), "episode");
        assert_eq!(queue.advance(false).unwrap().track.key.as_opaque(), "later");
        if !shuffle {
            assert_eq!(queue.advance(false).unwrap().watch_autoplay, None);
            assert!(queue.advance(false).is_none());
        }
    }
}

#[test]
fn turning_autoplay_off_keeps_the_manual_next_item() {
    let mut queue = Queue::from_tracks(&[track("watch")], 0);
    queue.continue_watching(Some(&[track("next")]), false);
    assert_eq!(queue.current().unwrap().watch_autoplay, Some(WatchAutoplay::Off));
    assert_eq!(queue.advance(false).unwrap().track.key.as_opaque(), "next");
}


#[test]
fn last_video_finishes_its_parts_then_waits_before_the_old_queue() {
    let mut queue = Queue::from_tracks(&[track("A"), track("X")], 0);
    queue.continue_watching(Some(&[track("B")]), true);
    assert!(queue.current().unwrap().watch_autoplay.unwrap().permits(false));
    let b = queue.advance(false).unwrap();
    assert_eq!(b.track.key.as_opaque(), "B");
    let policy = b.watch_autoplay.unwrap();
    assert!(policy.permits(true));
    assert!(!policy.permits(false));
    assert_eq!(queue.advance(false).unwrap().track.key.as_opaque(), "X");

    for (following, autoplay_next) in [(Some([].as_slice()), false), (None, true)] {
        let mut queue = Queue::from_tracks(&[track("A"), track("X")], 0);
        queue.continue_watching(following, true);
        assert_eq!(queue.current().unwrap().watch_autoplay.unwrap().permits(false), autoplay_next);
    }
}
