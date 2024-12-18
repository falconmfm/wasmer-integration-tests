
## **Task 03 - SRE Interview Task**

This directory contains a **PHP** application with a **MySQL** database connection, its configuration for deployment on **Wasmer**, and an automated test suite to validate its behavior.

---

### **Project Structure**

```plaintext

├── php_mysql_app
│   ├── app
│   │   └── index.php          # Main PHP application file
│   ├── app.yaml               # Wasmer app configuration file
│   └── wasmer.toml            # Additional Wasmer configuration
├── run.sh                     # Script for local execution or preparation
├── test
│   └── php_mysql_test.ts      # Automated Deno test
└── test.ts                    # Helper for loading environment variables
```

---

### **Prerequisites**

Before running the project, make sure to install the following:

1. **Wasmer CLI**  
   [Installation Instructions](https://docs.wasmer.io/install)  
   ```bash
   curl https://get.wasmer.io -sSfL | sh
   ```

2. **Deno** (to run the tests)  
   [Installation Instructions](https://deno.land/)  
   ```bash
   curl -fsSL https://deno.land/install.sh | sh
   ```

3. **Wasmer Access Token**  
   - Log in to Wasmer CLI:  
     ```bash
     wasmer login
     ```
    > ⚠️ Note: You might need to reload the session to apply the environment variables.
   - Create an **Access TOKEN** in the Wasmer web admin.  
   - Export the token as an environment variable:  
     ```bash
     export WASMER_TOKEN=your_token_here
     ```



---

### **Application Configuration**

1. Go to the `php_mysql_app` directory.

2. Edit the `app.yaml` file to include your personalized information:
   ```yaml
   name: php-mysql-app            # Application name
   app_id: da_Ko6IotJULk82        # Application ID
   owner: falconmfm               # Owner user
   package: '.'
   ```

---

### **Deploying the Application**

1. Go to the `php_mysql_app` directory:
   ```bash
   cd php_mysql_app
   ```

2. Deploy the application with the following command:
   ```bash
   wasmer deploy
   ```

3. If the process completes successfully, Wasmer CLI will provide a link to access the deployed application.

---

### **Running Automated Tests**

The `test` folder contains an automated test that validates the PHP application with its MySQL database connection.

1. Navigate to the `./test` directory:
   ```bash
   cd test
   ```

2. Run the test using **Deno**:
   ```bash
   DENO_JOBS=8 deno test --allow-all --parallel .
   ```

3. The test uses the helper file `../test.ts` to load the required environment variables.

---

### **Important Notes**

- The application uses the **PHP MySQL extension**, which allows basic SQL queries.
- To initialize a database table, modify the `index.php` file in the `php_mysql_app/app` folder.
- You may need to deploy the application **twice** for the environment variables to be available (this is due to a current bug).

---

### **Contact and Feedback**

For questions or issues with the project, please feel free to contact me or open a discussion thread in the corresponding repository.

---
``` 

This translation is clear, simple, and adjusted to a **B2-level** of English while maintaining all the instructions and technical details intact. Let me know if you need any further refinements!