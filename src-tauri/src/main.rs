// niente finestra della console su Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    calendario_lib::run()
}
