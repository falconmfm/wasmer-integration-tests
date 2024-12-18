<?php
$host = getenv("DB_HOST");
$db = getenv("DB_NAME");
$user = getenv("DB_USERNAME");
$pass = getenv("DB_PASSWORD");

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // Create a table if not exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS test_table (id INT AUTO_INCREMENT PRIMARY KEY, message VARCHAR(255))");

    // Insert a test record
    $stmt = $pdo->prepare("INSERT INTO test_table (message) VALUES (:message)");
    $stmt->execute(['message' => 'Hello, Wasmer!']);

    // Query the table
    $stmt = $pdo->query("SELECT * FROM test_table");
    $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($results);
} catch (PDOException $e) {
    echo "Database connection failed: " . $e->getMessage();
}
?>

