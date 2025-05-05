import express, { Request, Response } from "express";
import pm2 from "pm2";
import type { ProcessDescription } from "pm2";

const app = express();
const port = process.env.MONITOR_PORT || 3000;

interface ProcessStatus {
  name: string;
  status: string;
  instances: {
    total: number;
    online: number;
    offline: number;
  };
}

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

    // Group processes by name and count instances
    const processStatusMap = processes.reduce(
      (acc, proc) => {
        const name = proc.name ?? "unnamed";
        const status = proc.pm2_env?.status ?? "unknown";

        if (!acc[name]) {
          acc[name] = {
            name,
            status: "online", // Will be set to 'offline' if any instance is offline
            instances: {
              total: 0,
              online: 0,
              offline: 0,
            },
          };
        }

        acc[name].instances.total += 1;
        if (status === "online") {
          acc[name].instances.online += 1;
        } else {
          acc[name].instances.offline += 1;
          acc[name].status = "offline"; // Mark as offline if any instance is offline
        }

        return acc;
      },
      {} as Record<string, ProcessStatus>,
    );

    const processStatus = Object.values(processStatusMap);
    const offlineProcesses = processStatus.filter(
      (proc) => proc.status !== "online",
    );

    if (offlineProcesses.length > 0) {
      res.status(500).json({
        status: "error",
        message: "Some processes are offline",
        offlineProcesses,
        allProcesses: processStatus,
      });
      return;
    }

    res.status(200).json({
      status: "ok",
      processes: processStatus,
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

app.get("/health", healthCheck);

export function startMonitor() {
  app.listen(port, () => {
    console.log(`Monitor API listening on port ${port}`);
  });
}
