//! Application error type, serializable for the Tauri IPC boundary.

use thiserror::Error;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),

    #[error("input contains control characters")]
    ControlChars,

    #[error("not found: {0}")]
    NotFound(String),

    #[error("database already contains data — pass `force` to migrate anyway")]
    TargetNotEmpty,

    #[error("restore refused: the confirmation flag was not set")]
    RestoreNotConfirmed,

    #[error("backup file integrity check failed (checksum mismatch)")]
    ChecksumMismatch,

    #[error("unsupported backup version {0}")]
    UnsupportedBackupVersion(u32),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    /// Stable machine-readable code used by the frontend / IPC layer.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Validation(_) => "VALIDATION",
            AppError::ControlChars => "VALIDATION",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::TargetNotEmpty => "TARGET_NOT_EMPTY",
            AppError::RestoreNotConfirmed => "RESTORE_NOT_CONFIRMED",
            AppError::ChecksumMismatch => "CHECKSUM_MISMATCH",
            AppError::UnsupportedBackupVersion(_) => "UNSUPPORTED_BACKUP_VERSION",
            AppError::Io(_) => "IO",
            AppError::Db(_) => "DB",
            AppError::Json(_) => "JSON",
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

/// Map a raw SQLite error into a friendly validation error when the cause is
/// a constraint violation (the CHECK constraints are the last line of defense).
pub fn map_constraint(err: rusqlite::Error, what: &str) -> AppError {
    match &err {
        rusqlite::Error::SqliteFailure(e, _)
            if e.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            AppError::Validation(format!("{what} (rejected by database constraints)"))
        }
        _ => AppError::Db(err),
    }
}
