//! Legacy Prisma database migration tests: build a database with the exact
//! schema of `db/custom.db` (floats, unix-ms timestamps) and prove every row
//! survives the move to integer cents — with warnings for anything odd.

use std::path::PathBuf;

use finances_core::migrate::migrate_legacy;
use finances_core::repo;
use finances_core::Store;

fn legacy_schema_sql() -> String {
    // Mirrors `prisma/schema.prisma` as Prisma materializes it in SQLite.
    r#"
    CREATE TABLE "Income" (
        id        TEXT PRIMARY KEY NOT NULL,
        person    TEXT NOT NULL,
        month     TEXT NOT NULL,
        amount    REAL NOT NULL DEFAULT 0,
        mealCard  REAL NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX "Income_person_month_key" ON "Income"(person, month);
    CREATE TABLE "Expense" (
        id          TEXT PRIMARY KEY NOT NULL,
        name        TEXT NOT NULL,
        amount      REAL NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'expense',
        category    TEXT NOT NULL DEFAULT 'Other',
        responsible TEXT NOT NULL DEFAULT 'shared',
        joaoShare   REAL NOT NULL DEFAULT 50,
        joaoPaid    REAL,
        annaPaid    REAL,
        dueDate     TEXT,
        paid        INTEGER NOT NULL DEFAULT 0,
        notes       TEXT,
        month       TEXT NOT NULL,
        createdAt   INTEGER NOT NULL,
        updatedAt   INTEGER NOT NULL
    );
    CREATE INDEX "Expense_month_idx" ON "Expense"(month);
    "#
    .to_string()
}

struct Fixture {
    #[allow(dead_code)]
    dir: tempfile::TempDir,
    path: PathBuf,
    conn: rusqlite::Connection,
}

fn build_legacy_db(rows: &[&str]) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("custom.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(&legacy_schema_sql()).unwrap();
    for sql in rows {
        conn.execute(sql, []).unwrap();
    }
    Fixture { dir, path, conn }
}

#[test]
fn real_world_data_migrates_losslessly() {
    // The exact shape of rows found in the user's db/custom.db.
    let f = build_legacy_db(&[
        "INSERT INTO Income VALUES ('cmwb37x3z0000os6d07mr5z5g','joao','2026-11',2000.0,0.0,1794339181151,1794350914907)",
        "INSERT INTO Income VALUES ('cmwb37x3z0001os6dqueivt46','anna','2026-11',1800.0,50.5,1794339181151,1794342927649)",
        "INSERT INTO Expense VALUES ('cmwb37x400002os6dbjjqvobp','Rent',800.0,'expense','Housing','shared',50.0,NULL,NULL,NULL,1,'expires on the 1st','2026-11',1794339181152,1794350914908)",
        "INSERT INTO Expense VALUES ('cmwb37x400003os6d7d5mjr6q','Electricity',120.35,'expense','Utilities','shared',50.0,70.5,NULL,'2026-11-08',0,NULL,'2026-11',1794339181153,1794350914909)",
        "INSERT INTO Expense VALUES ('cmwb37x400004os6diittsfwi','Bonus','250.0','credit','Other','joao',100.0,NULL,NULL,NULL,0,'payment received','2026-11',1794339181154,1794350914910)",
    ]);
    drop(f.conn);

    let store = Store::open_in_memory().unwrap();
    let report = migrate_legacy(&store, &f.path, false).unwrap();

    assert_eq!(report.expenses_migrated, 3);
    assert_eq!(report.incomes_migrated, 2);
    assert!(report.warnings.is_empty(), "no warnings for clean data: {:?}", report.warnings);

    // Amounts became exact integer cents.
    let expenses = repo::list_all_expenses(&store.conn).unwrap();
    let by_name = |name: &str| expenses.iter().find(|e| e.name == name).unwrap();
    assert_eq!(by_name("Rent").amount_cents, 80_000);
    assert_eq!(by_name("Electricity").amount_cents, 12_035);
    assert_eq!(by_name("Electricity").joao_paid_cents, Some(7_050));
    assert_eq!(by_name("Electricity").anna_paid_cents, Some(4_985));
    assert_eq!(by_name("Bonus").amount_cents, 25_000);

    // Ids and timestamps preserved.
    assert_eq!(by_name("Rent").id, "cmwb37x400002os6dbjjqvobp");
    assert!(by_name("Rent").created_at.starts_with("20"));

    // Incomes preserved (float 50.5 → 5050 cents).
    let incomes = repo::list_all_incomes(&store.conn).unwrap();
    let anna = incomes.iter().find(|i| i.person == finances_core::validation::Person::Anna).unwrap();
    assert_eq!(anna.salary_cents, 180_000);
    assert_eq!(anna.meal_card_cents, 5_050);

    // Refuses to run again on a non-empty target without force.
    let err = migrate_legacy(&store, &f.path, false).unwrap_err();
    assert!(matches!(err, finances_core::AppError::TargetNotEmpty));
    // …and succeeds with force (same result, idempotent row count).
    let again = migrate_legacy(&store, &f.path, true).unwrap();
    assert_eq!(again.expenses_migrated, 3);
    assert_eq!(repo::count_expenses(&store.conn).unwrap(), 3);
}

#[test]
fn dirty_rows_are_repaired_and_reported_never_dropped() {
    let f = build_legacy_db(&[
        // normal row
        "INSERT INTO Expense VALUES ('e1','Fine',10.0,'expense','Other','shared',50.0,NULL,NULL,NULL,0,NULL,'2026-11',1794339181151,1794339181151)",
        // empty name
        "INSERT INTO Expense VALUES ('e2','',30.0,'expense','Other','shared',50.0,NULL,NULL,NULL,0,NULL,'2026-11',1794339181151,1794339181151)",
        // zero amount
        "INSERT INTO Expense VALUES ('e3','Free',0.0,'expense','Other','shared',50.0,NULL,NULL,NULL,0,NULL,'2026-11',1794339181151,1794339181151)",
        // unknown kind / responsible / month / due date
        "INSERT INTO Expense VALUES ('e4','Weird',10.0,'mystery','Nope','nobody',150.0,NULL,NULL,NULL,0,NULL,'2026-1',1794339181151,1794339181151)",
        // injection-looking content must stay verbatim
        "INSERT INTO Expense VALUES ('e5','x''); DROP TABLE Expense;--',5.0,'expense','Other','shared',50.0,NULL,NULL,NULL,0,''' OR ''1''=''1','2026-11',1794339181151,1794339181151)",
    ]);
    drop(f.conn);

    let store = Store::open_in_memory().unwrap();
    let report = migrate_legacy(&store, &f.path, false).unwrap();

    // Every row survived.
    assert_eq!(report.expenses_migrated, 5);
    assert!(report.warnings.len() >= 4, "expected warnings: {:?}", report.warnings);

    let expenses = repo::list_all_expenses(&store.conn).unwrap();
    let by_id = |id: &str| expenses.iter().find(|e| e.id == id).unwrap();
    assert_eq!(by_id("e1").amount_cents, 1_000);
    assert_eq!(by_id("e2").name, "(sem nome)");
    assert_eq!(by_id("e3").amount_cents, 1); // clamped to the minimum
    assert_eq!(by_id("e4").month, "1970-01");
    assert_eq!(by_id("e4").responsible, finances_core::validation::Responsible::Shared);
    assert_eq!(by_id("e4").joao_share, 50.0);
    assert_eq!(
        by_id("e5").name,
        "x'); DROP TABLE Expense;--",
        "injection content must survive verbatim (SQL '' unescapes to one quote)"
    );
    // The legacy table itself is untouched (read-only access).
    assert_eq!(repo::count_expenses(&store.conn).unwrap(), 5);
}

#[test]
fn migration_of_missing_file_fails_cleanly() {
    let store = Store::open_in_memory().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let err = migrate_legacy(&store, &dir.path().join("nope.db"), false).unwrap_err();
    assert!(matches!(err, finances_core::AppError::NotFound(_)));
}

#[test]
fn full_pipeline_migration_then_summary_is_sane() {
    // Migration of the real-world fixture, then a summary computed on it.
    let f = build_legacy_db(&[
        "INSERT INTO Income VALUES ('i1','joao','2026-11',2000.0,50.0,1794339181151,1794339181151)",
        "INSERT INTO Income VALUES ('i2','anna','2026-11',1800.0,0.0,1794339181151,1794339181151)",
        "INSERT INTO Expense VALUES ('e1','Rent',800.0,'expense','Housing','shared',50.0,NULL,NULL,NULL,0,NULL,'2026-11',1794339181151,1794339181151)",
    ]);
    drop(f.conn);

    let store = Store::open_in_memory().unwrap();
    migrate_legacy(&store, &f.path, false).unwrap();

    let expenses = repo::list_expenses_by_month(&store.conn, "2026-11").unwrap();
    let incomes = repo::list_incomes_by_month(&store.conn, "2026-11").unwrap();
    let summary = repo::compute_summary(&expenses, &incomes, "2026-11-13");
    assert_eq!(summary.total_income_cents, 385_000);
    assert_eq!(summary.total_expenses_cents, 80_000);
    assert_eq!(summary.total_available_cents, 305_000);
    assert_eq!(summary.unpaid_count, 1);
}
