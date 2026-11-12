import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure logs directory exists
const logsDir = path.resolve(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Get the log file path for today's date
 */
function getLogFilePath(type: "app" | "error"): string {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const filename = type === "error" ? `error-${today}.log` : `app-${today}.log`;
  return path.join(logsDir, filename);
}

/**
 * Write a log message to file
 */
function writeToFile(type: "app" | "error", message: string): void {
  try {
    const filePath = getLogFilePath(type);
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    
    // Append to file (creates if doesn't exist)
    fs.appendFileSync(filePath, logLine, "utf8");
  } catch (error) {
    // Silently fail - don't break the app if logging fails
    // But log to console as fallback
    console.error("Failed to write to log file:", error);
  }
}

/**
 * Enhanced log function that writes to both console and file
 */
export function logToFile(message: string, source = "express"): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const logMessage = `${formattedTime} [${source}] ${message}`;
  
  // Write to console (for Docker stdout/stderr)
  console.log(logMessage);
  
  // Also write to file
  writeToFile("app", logMessage);
}

/**
 * Convenience log function (alias for logToFile with default source)
 */
export function log(message: string, source = "express"): void {
  logToFile(message, source);
}

/**
 * Enhanced error log function that writes to both console and file
 */
export function errorToFile(message: string, error?: Error | unknown, source = "error"): void {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  let logMessage = `${formattedTime} [${source}] ${message}`;
  
  if (error instanceof Error) {
    logMessage += `\n  Error: ${error.message}\n  Stack: ${error.stack}`;
  } else if (error) {
    logMessage += `\n  Error: ${String(error)}`;
  }

  // Write to console.error (for Docker stderr)
  console.error(logMessage);
  
  // Also write to error log file
  writeToFile("error", logMessage);
}

/**
 * Setup console.log and console.error interceptors to also write to files
 * This ensures ALL console output is captured, not just explicit log() calls
 */
export function setupConsoleLogging(): void {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    const message = args.map(arg => 
      typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(" ");
    
    originalLog.apply(console, args);
    writeToFile("app", message);
  };

  console.error = (...args: unknown[]) => {
    const message = args.map(arg => 
      typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(" ");
    
    originalError.apply(console, args);
    writeToFile("error", message);
  };

  console.warn = (...args: unknown[]) => {
    const message = args.map(arg => 
      typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(" ");
    
    originalWarn.apply(console, args);
    writeToFile("app", `[WARN] ${message}`);
  };
}

