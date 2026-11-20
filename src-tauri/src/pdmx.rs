// The PDMX collection (zenodo.org/records/15571083): about 250,000 public
// domain scores from MuseScore, offered only as large archives. Getting it
// reads the 225 MB index as it downloads, keeps the solo piano pieces, then
// streams the 1.9 GB MusicXML archive and writes out only those pieces, so
// neither download is ever kept. Everything lands in <data>\PDMX: index.json
// and scores\<name>.mxl. Each person's app downloads its own copy; nothing
// is hosted by us.
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

const RECORD: &str = "https://zenodo.org/records/15571083/files/";
const INDEX: &str = "PDMX.csv";
const SCORES: &str = "mxl.tar.gz";
// Over this a single score is skipped: the largest piano scores are a few MB.
const MAX_SCORE: u64 = 8 * 1024 * 1024;

#[derive(Default)]
pub struct Job {
    running: AtomicBool,
    cancel: AtomicBool,
    last: Mutex<Option<Progress>>,
}

#[derive(Serialize, Clone, Default)]
pub struct Progress {
    // "index", "scores", "done", "cancelled" or "error".
    phase: String,
    done: u64,
    total: u64,
    pieces: usize,
    found: usize,
    message: String,
}

#[derive(Serialize, Clone)]
pub struct Piece {
    pub title: String,
    pub composer: String,
    pub rating: f32,
    pub level: u8,
    pub genres: String,
    pub licence: String,
    pub file: String,
}

fn truthy(s: &str) -> bool {
    s.eq_ignore_ascii_case("true") || s == "1"
}
fn present(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s == "NA" || s.eq_ignore_ascii_case("nan") || s.eq_ignore_ascii_case("none") {
        None
    } else {
        Some(s.to_string())
    }
}
// MuseScore's file name: the last part of the CSV's mxl path or a tar
// member's name, so the two match whatever folders either puts first.
pub fn file_name(path: &str) -> Option<String> {
    let name = path.trim().rsplit(['/', '\\']).next()?;
    let ok = name.len() > 4
        && name.len() <= 128
        && name.to_ascii_lowercase().ends_with(".mxl")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        && !name.starts_with('.');
    ok.then(|| name.to_string())
}

// Solo piano: one or two parts, each General MIDI 0-3 (the acoustic and
// electric grands, honky-tonk). Rated, unless asked for all, because the
// unrated ones are mostly single-line tunes on MuseScore's default piano.
pub fn read_index<R: Read>(input: R, unrated: bool) -> Result<Vec<Piece>, String> {
    let mut rd = csv::ReaderBuilder::new().flexible(true).from_reader(input);
    let head = rd.headers().map_err(|e| e.to_string())?.clone();
    let col = |name: &str| head.iter().position(|h| h.trim_start_matches('\u{feff}') == name);
    let need = |name: &str| col(name).ok_or_else(|| format!("The PDMX index has no {name} column."));
    let (mxl, tracks, n_tracks, rating) = (need("mxl")?, need("tracks")?, need("n_tracks")?, need("rating")?);
    let (no_conflict, valid, dedup) = (need("subset:no_license_conflict")?, need("subset:all_valid")?, need("subset:deduplicated")?);
    let (title, song, composer, artist) = (col("title"), col("song_name"), col("composer_name"), col("artist_name"));
    let (complexity, genres, licence) = (col("complexity"), col("genres"), col("license"));
    let mut out = Vec::new();
    for rec in rd.records() {
        let r = rec.map_err(|e| e.to_string())?;
        let get = |i: usize| r.get(i).unwrap_or("");
        let opt = |i: Option<usize>| i.and_then(|i| present(get(i)));
        if !(truthy(get(no_conflict)) && truthy(get(valid)) && truthy(get(dedup))) {
            continue;
        }
        let parts = get(n_tracks).trim().parse::<f32>().unwrap_or(0.0);
        if !(1.0..=2.0).contains(&parts) {
            continue;
        }
        if !get(tracks).split('-').all(|p| matches!(p.trim(), "0" | "1" | "2" | "3")) {
            continue;
        }
        let stars = get(rating).trim().parse::<f32>().unwrap_or(0.0);
        if !unrated && stars <= 0.0 {
            continue;
        }
        let Some(file) = file_name(get(mxl)) else { continue };
        out.push(Piece {
            title: opt(title).or_else(|| opt(song)).unwrap_or_else(|| file.trim_end_matches(".mxl").to_string()),
            composer: opt(composer).or_else(|| opt(artist)).unwrap_or_default(),
            rating: (stars * 100.0).round() / 100.0,
            level: opt(complexity).and_then(|s| s.parse::<f32>().ok()).map_or(0, |x| x.clamp(0.0, 3.0) as u8),
            genres: opt(genres).unwrap_or_default(),
            licence: opt(licence).unwrap_or_default(),
            file,
        });
    }
    Ok(out)
}

// Writes the wanted members of a .tar.gz stream into dir; returns the names
// written. stop is checked between members.
pub fn extract<R: Read>(input: R, wanted: &HashMap<String, usize>, dir: &Path, stop: &dyn Fn(usize) -> bool) -> Result<Vec<String>, String> {
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(input));
    let mut got = Vec::new();
    for entry in tar.entries().map_err(|e| e.to_string())? {
        if stop(got.len()) {
            break;
        }
        let mut entry = entry.map_err(|e| e.to_string())?;
        if !entry.header().entry_type().is_file() || entry.size() > MAX_SCORE {
            continue;
        }
        let name = match entry.path().ok().and_then(|p| file_name(&p.to_string_lossy())) {
            Some(n) if wanted.contains_key(&n) => n,
            _ => continue,
        };
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        fs::write(dir.join(&name), bytes).map_err(|e| e.to_string())?;
        got.push(name);
        if got.len() == wanted.len() {
            break;
        }
    }
    Ok(got)
}

// Counts what's read, for the progress bar.
struct Counted<R> {
    inner: R,
    read: u64,
    on: Box<dyn FnMut(u64) + Send>,
}
impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read += n as u64;
        (self.on)(self.read);
        Ok(n)
    }
}

fn open(file: &str) -> Result<(reqwest::blocking::Response, u64), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Piano (practice app)")
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(None)
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 || a.url().scheme() != "https" {
                a.stop()
            } else {
                a.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(format!("{RECORD}{file}?download=1")).send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Zenodo answered HTTP {}", res.status().as_u16()));
    }
    let len = res.content_length().unwrap_or(0);
    Ok((res, len))
}

pub fn folder(data: &Path) -> PathBuf {
    data.join("PDMX")
}

#[derive(Serialize)]
struct Saved<'a> {
    source: &'static str,
    licence: &'static str,
    made: u64,
    unrated: bool,
    pieces: &'a [Piece],
}

fn run(app: &tauri::AppHandle, job: &Job, data: &Path, unrated: bool) -> Result<usize, String> {
    let report = |p: Progress| {
        *job.last.lock().unwrap() = Some(p.clone());
        let _ = app.emit("pdmx", p);
    };
    let tick = |phase: &'static str, total: u64, pieces: usize| {
        let app = app.clone();
        let mut shown = 0u64;
        move |n: u64| {
            if n - shown >= 1 << 20 || n == total {
                shown = n;
                let _ = app.emit("pdmx", Progress { phase: phase.into(), done: n, total, pieces, ..Default::default() });
            }
        }
    };
    let cancelled = || job.cancel.load(Ordering::Relaxed);

    report(Progress { phase: "index".into(), ..Default::default() });
    let (res, total) = open(INDEX)?;
    let pieces = read_index(Counted { inner: res, read: 0, on: Box::new(tick("index", total, 0)) }, unrated)?;
    if cancelled() {
        return Err("cancelled".into());
    }
    if pieces.is_empty() {
        return Err("No piano pieces were found in the PDMX index.".into());
    }

    let part = data.join("PDMX.part");
    let _ = fs::remove_dir_all(&part);
    fs::create_dir_all(part.join("scores")).map_err(|e| e.to_string())?;
    let wanted: HashMap<String, usize> = pieces.iter().enumerate().map(|(i, p)| (p.file.clone(), i)).collect();
    report(Progress { phase: "scores".into(), pieces: pieces.len(), ..Default::default() });
    let (res, total) = open(SCORES)?;
    let n = pieces.len();
    let got = extract(Counted { inner: res, read: 0, on: Box::new(tick("scores", total, n)) }, &wanted, &part.join("scores"), &|_| cancelled())?;
    if cancelled() {
        let _ = fs::remove_dir_all(&part);
        return Err("cancelled".into());
    }
    let have: std::collections::HashSet<&String> = got.iter().collect();
    let kept: Vec<Piece> = pieces.into_iter().filter(|p| have.contains(&p.file)).collect();
    let made = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let json = serde_json::to_string(&Saved { source: "https://zenodo.org/records/15571083", licence: "CC-BY-4.0", made, unrated, pieces: &kept }).map_err(|e| e.to_string())?;
    fs::write(part.join("index.json"), json).map_err(|e| e.to_string())?;
    let dest = folder(data);
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&part, &dest).map_err(|e| e.to_string())?;
    Ok(kept.len())
}

// Starts getting the collection in the background; "pdmx" events report it.
#[tauri::command]
pub fn pdmx_get(app: tauri::AppHandle, job: tauri::State<'_, std::sync::Arc<Job>>, location: tauri::State<'_, crate::portable::Location>, unrated: bool) -> Result<(), String> {
    if job.running.swap(true, Ordering::SeqCst) {
        return Err("running".into());
    }
    job.cancel.store(false, Ordering::SeqCst);
    let job = job.inner().clone();
    let data = location.dir.clone();
    std::thread::spawn(move || {
        let end = match run(&app, &job, &data, unrated) {
            Ok(found) => Progress { phase: "done".into(), found, ..Default::default() },
            Err(e) if e == "cancelled" => Progress { phase: "cancelled".into(), ..Default::default() },
            Err(message) => Progress { phase: "error".into(), message, ..Default::default() },
        };
        if end.phase != "done" {
            let _ = fs::remove_dir_all(data.join("PDMX.part"));
        }
        *job.last.lock().unwrap() = Some(end.clone());
        job.running.store(false, Ordering::SeqCst);
        let _ = app.emit("pdmx", end);
    });
    Ok(())
}

#[tauri::command]
pub fn pdmx_cancel(job: tauri::State<'_, std::sync::Arc<Job>>) {
    job.cancel.store(true, Ordering::SeqCst);
}

// Whether it's being fetched now, and how far it got.
#[tauri::command]
pub fn pdmx_status(job: tauri::State<'_, std::sync::Arc<Job>>) -> Option<Progress> {
    if job.running.load(Ordering::SeqCst) {
        job.last.lock().unwrap().clone()
    } else {
        None
    }
}

// index.json as text, or None before it's been got.
#[tauri::command]
pub fn pdmx_index(location: tauri::State<'_, crate::portable::Location>) -> Option<String> {
    fs::read_to_string(folder(&location.dir).join("index.json")).ok()
}

#[tauri::command]
pub fn pdmx_file(location: tauri::State<'_, crate::portable::Location>, name: String) -> Result<tauri::ipc::Response, String> {
    let name = file_name(&name).filter(|n| *n == name).ok_or("badname")?;
    fs::read(folder(&location.dir).join("scores").join(name)).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pdmx_remove(job: tauri::State<'_, std::sync::Arc<Job>>, location: tauri::State<'_, crate::portable::Location>) -> Result<(), String> {
    if job.running.load(Ordering::SeqCst) {
        return Err("running".into());
    }
    let dir = folder(&location.dir);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSV: &str = "path,mxl,title,song_name,composer_name,artist_name,rating,complexity,genres,license,n_tracks,tracks,subset:deduplicated,subset:no_license_conflict,subset:all_valid\n\
./data/a.json,./mxl/1/2/Qa.mxl,Minuet,,J. S. Bach,,4.8,1,classical,publicdomain,1,0,True,True,True\n\
./data/b.json,./mxl/1/2/Qb.mxl,\"Theme, with comma\",,NA,Someone,4.5,2,soundtrack,cc-zero,2,0-0,True,True,True\n\
./data/c.json,./mxl/1/2/Qc.mxl,Unrated tune,,,Misc tunes,0.0,1,,publicdomain,1,0,True,True,True\n\
./data/d.json,./mxl/1/2/Qd.mxl,Strings,,,,4.9,1,,publicdomain,4,52-52-52-52,True,True,True\n\
./data/e.json,./mxl/1/2/Qe.mxl,Conflict,,,,4.9,1,,publicdomain,1,0,True,False,True\n\
./data/f.json,./mxl/1/2/Qf.mxl,Duplicate,,,,4.9,1,,publicdomain,1,0,False,True,True\n\
./data/g.json,./mxl/1/2/Qg.mxl,Violin and piano,,,,4.9,1,,publicdomain,2,0-40,True,True,True\n\
./data/h.json,../../evil.exe,Bad path,,,,4.9,1,,publicdomain,1,0,True,True,True\n";

    #[test]
    fn keeps_rated_solo_piano() {
        let p = read_index(CSV.as_bytes(), false).unwrap();
        let names: Vec<_> = p.iter().map(|x| x.title.as_str()).collect();
        assert_eq!(names, ["Minuet", "Theme, with comma"]);
        assert_eq!(p[0].file, "Qa.mxl");
        assert_eq!(p[0].composer, "J. S. Bach");
        assert_eq!(p[1].composer, "Someone");
        assert_eq!(p[1].level, 2);
        let all = read_index(CSV.as_bytes(), true).unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn names_are_plain_files() {
        assert_eq!(file_name("./mxl/1/2/Qa.mxl").as_deref(), Some("Qa.mxl"));
        assert_eq!(file_name("mxl\\1\\Qa.mxl").as_deref(), Some("Qa.mxl"));
        assert!(file_name("../../evil.exe").is_none());
        assert!(file_name("./mxl/..mxl").is_none());
        assert!(file_name("a b.mxl").is_none());
    }

    #[test]
    fn extracts_only_wanted_members() {
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        {
            let mut tar = tar::Builder::new(&mut gz);
            for (name, body) in [("./mxl/1/2/Qa.mxl", "A"), ("./mxl/1/2/Qz.mxl", "Z"), ("./mxl/1/2/Qb.mxl", "B")] {
                let mut h = tar::Header::new_gnu();
                h.set_size(body.len() as u64);
                h.set_mode(0o644);
                h.set_cksum();
                tar.append_data(&mut h, name, body.as_bytes()).unwrap();
            }
            tar.finish().unwrap();
        }
        let bytes = gz.finish().unwrap();
        let dir = std::env::temp_dir().join(format!("pdmx-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let wanted: HashMap<String, usize> = [("Qa.mxl".to_string(), 0), ("Qb.mxl".to_string(), 1)].into();
        let got = extract(&bytes[..], &wanted, &dir, &|_| false).unwrap();
        assert_eq!(got, ["Qa.mxl", "Qb.mxl"]);
        assert_eq!(fs::read_to_string(dir.join("Qb.mxl")).unwrap(), "B");
        assert!(!dir.join("Qz.mxl").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
