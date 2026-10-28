// The desktop bridge and tests use exactly the same domain and storage modules.
#[path = "../../src/model.rs"]
pub mod model;
#[path = "../../src/domain.rs"]
pub mod domain;
#[path = "../../src/importer.rs"]
pub mod importer;
#[path = "../../src/alipay.rs"]
pub mod alipay;
#[path = "../../src/assets.rs"]
pub mod assets;
#[path = "../../src/storage.rs"]
pub mod storage;
pub use model::*;
pub static MUTATIONS: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[cfg(test)]
#[path = "../../src/tests.rs"]
mod tests;
