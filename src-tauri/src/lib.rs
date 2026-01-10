use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

#[cfg(target_os = "macos")]
fn apply_window_effects(window: &WebviewWindow) {
    let _ = apply_vibrancy(
        window,
        NSVisualEffectMaterial::HudWindow,
        Some(NSVisualEffectState::Active),
        Some(10.0),
    );
}

#[tauri::command]
async fn open_settings(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = tauri::WebviewWindowBuilder::new(
            &app,
            "settings",
            tauri::WebviewUrl::App("index.html#settings".into()),
        )
        .title("Settings")
        .inner_size(600.0, 500.0)
        .resizable(false)
        .visible(true)
        .build();
    }
}

#[tauri::command]
async fn open_spotify() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("/Applications/Spotify.app")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_apple_music() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("/System/Applications/Music.app")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn load_icon(app: &tauri::App) -> Image<'static> {
    // Build list of paths to try - resource dir first (for bundled app), then dev paths
    let mut paths_to_try: Vec<std::path::PathBuf> = Vec::new();
    
    // In bundled app, the icon is in the Resources folder
    if let Ok(resource_dir) = app.path().resource_dir() {
        paths_to_try.push(resource_dir.join("icons/icon-template.png"));
    }
    
    // Dev paths
    paths_to_try.push(std::path::PathBuf::from("icons/icon-template.png"));
    paths_to_try.push(std::path::PathBuf::from("src-tauri/icons/icon-template.png"));
    
    for path in &paths_to_try {
        if path.exists() {
            if let Ok(bytes) = std::fs::read(path) {
                if let Ok(img) = image::load_from_memory(&bytes) {
                    let mut rgba = img.to_rgba8();
                    let (width, height) = rgba.dimensions();
                    
                    // Auto-crop: Find bounding box
                    let mut min_x = width;
                    let mut min_y = height;
                    let mut max_x = 0;
                    let mut max_y = 0;
                    let mut has_content = false;
                    
                    for (x, y, pixel) in rgba.enumerate_pixels() {
                        if pixel[3] > 0 { // Alpha > 0
                            if x < min_x { min_x = x; }
                            if x > max_x { max_x = x; }
                            if y < min_y { min_y = y; }
                            if y > max_y { max_y = y; }
                            has_content = true;
                        }
                    }
                    
                    if has_content {
                        let crop_width = max_x - min_x + 1;
                        let crop_height = max_y - min_y + 1;
                        
                        let cropped = image::imageops::crop(&mut rgba, min_x, min_y, crop_width, crop_height).to_image();
                        
                        // Scale up to 44px height (22pt) to maximize visibility
                        let final_img = if crop_height < 44 {
                            let scale = 44.0 / crop_height as f32;
                            let new_width = (crop_width as f32 * scale) as u32;
                            image::imageops::resize(&cropped, new_width, 44, image::imageops::FilterType::Lanczos3)
                        } else {
                            cropped
                        };

                        let (f_w, f_h) = final_img.dimensions();
                        return Image::new_owned(final_img.into_raw(), f_w, f_h);
                    }
                    
                    // Fallback if empty image
                    return Image::new_owned(rgba.into_raw(), width, height);
                }
            }
        }
    }
    
    // Fallback: create a simple placeholder icon (22x22 transparent)
    Image::new_owned(vec![0u8; 4 * 22 * 22], 22, 22)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![])))
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            let win = app.get_webview_window("main").unwrap();
            
            #[cfg(target_os = "macos")]
            apply_window_effects(&win);

            let quit_i = MenuItem::with_id(app, "quit", "Quit Musikbar", true, None::<&str>).unwrap();
            let settings_i = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>).unwrap();
            let report_i = MenuItem::with_id(app, "report_issue", "Report Issue", true, None::<&str>).unwrap();
            let sep = PredefinedMenuItem::separator(app).unwrap();
            let menu = Menu::with_items(app, &[&settings_i, &sep, &report_i, &sep, &quit_i]).unwrap();

            // Load icon
            let icon = load_icon(app);

            let tray = TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "settings" => {
                           let _ = tauri::async_runtime::block_on(open_settings(app.clone()));
                        }
                        "report_issue" => {
                            #[cfg(target_os = "macos")]
                             let _ = std::process::Command::new("open")
                                .arg("https://github.com/ulilicht/Musikbar/issues/new")
                                .spawn();
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Only handle left click release
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            // Get tray position using the rect
                            let (tray_x, tray_y, tray_width, tray_height) = match (rect.position, rect.size) {
                                (tauri::Position::Physical(pos), tauri::Size::Physical(size)) => {
                                    (pos.x as f64, pos.y as f64, size.width as f64, size.height as f64)
                                }
                                (tauri::Position::Logical(pos), tauri::Size::Logical(size)) => {
                                    (pos.x, pos.y, size.width, size.height)
                                }
                                (tauri::Position::Physical(pos), tauri::Size::Logical(size)) => {
                                    (pos.x as f64, pos.y as f64, size.width, size.height)
                                }
                                (tauri::Position::Logical(pos), tauri::Size::Physical(size)) => {
                                    (pos.x, pos.y, size.width as f64, size.height as f64)
                                }
                            };
                            
                            if let Ok(window_size) = window.outer_size() {
                                let window_width = window_size.width as f64;
                                let x = tray_x + (tray_width / 2.0) - (window_width / 2.0);
                                let y = tray_y + tray_height + 5.0;
                                let _ = window.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                            }
                            
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Store tray reference
            app.manage(tray);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(false) = event {
                // Hide main window on focus lost
                if window.label() == "main" {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![open_settings, open_spotify, open_apple_music])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
