// Free sheet music from the Mutopia Project (mutopiaproject.org): its
// search pages and its files, fetched here rather than in the page, which
// can't reach other sites (the CSP, and Mutopia sends no CORS headers).
// Only that host, only https, only GET, and nothing over MAX bytes.
const HOST: &str = "www.mutopiaproject.org";
const MAX: usize = 25 * 1024 * 1024;

fn allowed(url: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(url).map_err(|_| "badurl".to_string())?;
    if u.scheme() != "https" || u.host_str() != Some(HOST) || u.port().is_some() || !u.username().is_empty() {
        return Err("host".into());
    }
    let path = u.path();
    if !(path.starts_with("/cgibin/") || path.starts_with("/ftp/") || path == "/advsearch.html") {
        return Err("path".into());
    }
    Ok(u)
}

async fn get(url: &str) -> Result<Vec<u8>, String> {
    let u = allowed(url)?;
    let client = reqwest::Client::builder()
        .user_agent("Piano (practice app)")
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client.get(u).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    if res.content_length().map_or(false, |n| n as usize > MAX) {
        return Err("toolarge".into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        out.extend_from_slice(&chunk);
        if out.len() > MAX {
            return Err("toolarge".into());
        }
    }
    Ok(out)
}

// A search or listing page, as text.
#[tauri::command]
pub async fn catalog_page(url: String) -> Result<String, String> {
    let bytes = get(&url).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// A file (.mid, .pdf), as bytes.
#[tauri::command]
pub async fn catalog_file(url: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(get(&url).await?))
}

#[cfg(test)]
mod tests {
    use super::allowed;
    #[test]
    fn only_mutopia_over_https() {
        assert!(allowed("https://www.mutopiaproject.org/cgibin/make-table.cgi?searchingfor=minuet").is_ok());
        assert!(allowed("https://www.mutopiaproject.org/ftp/BachJS/BWVAnh120/BWV-120/BWV-120.mid").is_ok());
        assert!(allowed("http://www.mutopiaproject.org/ftp/a.mid").is_err());
        assert!(allowed("https://www.mutopiaproject.org.evil.com/ftp/a.mid").is_err());
        assert!(allowed("https://evil.com/?https://www.mutopiaproject.org/ftp/a.mid").is_err());
        assert!(allowed("https://user@www.mutopiaproject.org/ftp/a.mid").is_err());
        assert!(allowed("https://www.mutopiaproject.org:8443/ftp/a.mid").is_err());
        assert!(allowed("https://www.mutopiaproject.org/other").is_err());
    }
}
