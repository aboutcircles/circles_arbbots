import express, { Request, Response } from "express";
import pm2 from "pm2";
import type { ProcessDescription } from "pm2";

const app = express();
const port = process.env.MONITOR_PORT || 3000;

const healthCheck = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Connect to PM2
    await new Promise<void>((resolve, reject) => {
      pm2.connect((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Get list of processes
    const processes = await new Promise<ProcessDescription[]>(
      (resolve, reject) => {
        pm2.list((err, processlist) => {
          if (err) reject(err);
          else resolve(processlist);
        });
      },
    );

    const processStatus = processes.map((proc) => ({
      name: proc.name ?? "unnamed",
      status: proc.pm2_env?.status ?? "unknown",
    }));

    const offlineProcesses = processStatus.filter(
      (proc) => proc.status !== "online",
    );

    if (offlineProcesses.length > 0) {
      res.status(500).json({
        status: "error",
        offlineProcesses,
      });
      return;
    }

    res.status(200).json({
      status: "ok",
      onlineProcesses: processStatus,
    });
    return;
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to check process status",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return;
  } finally {
    pm2.disconnect();
  }
};

// Register the route handler
app.get("/health", healthCheck);

export function startMonitor() {
  app.listen(port, () => {
    console.log(`Monitor API listening on port ${port}`);
  });
}
