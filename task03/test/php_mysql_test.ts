import { TestEnv } from "../test.ts";
import { assertEquals,assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("Deploy PHP app with MySQL and validate database interaction", async () => {
  const env = TestEnv.fromEnv();

  // Define app specification
  const appSpec = {
    wasmerToml: {
      dependencies: {
        "php/php": "8.*",
      },
      fs: {
        "/src": "src",
      },
      command: [{
        name: "run",
        module: "php/php:php",
        runner: "wasi",
        annotations: {
          wasi: {
            "main-args": ["-t", "/src", "-S", "localhost:8080"],
          },
        },
      }],
    },
    appYaml: {
      
      kind: "wasmer.io/App.v0",
      name: "php-mysql-test",
      package: ".",
      scaling: { mode: "single_concurrency" },
      capabilities: { database: { engine: "mysql" } },
      debug: true,
    },
    files: {
      "src": {
        "index.php": `
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
      `,
      },
    },
  };


  // Deploy app
  const info = await env.deployApp(appSpec);

  // Send HTTP request and validate response
  const response = await env.fetchApp(info, "/");
  const body = await response.text();

  assertEquals(response.status, 200);
  assertStringIncludes(body.trim(), "Hello, Wasmer!");
});


