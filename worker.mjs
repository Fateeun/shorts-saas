import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = "videos";
const WORK_DIR = path.resolve("./tmp");
fs.mkdirSync(WORK_DIR, { recursive: true });

async function renderVerticalVideo(job) {
  const outPath = path.join(WORK_DIR, `${job.id}.mp4`);
  const safeTitle = (job.topic || "3D Football Shorts")
    .replaceAll(":", " ")
    .replaceAll("'", "")
    .slice(0, 60);

  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=0x0f172a:s=1080x1920:d=10:r=30",
    "-vf", `drawtext=text='${safeTitle}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    outPath
  ]);

  const buffer = fs.readFileSync(outPath);
  const storagePath = `${job.user_id}/${job.id}.mp4`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: "video/mp4",
      upsert: true
    });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  fs.unlinkSync(outPath);
  return data.publicUrl;
}

async function run() {
  const { data: jobs, error } = await supabase
    .from("video_jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  const job = jobs?.[0];
  if (!job) {
    console.log("Kuyrukta bekleyen is yok.");
    return;
  }

  await supabase
    .from("video_jobs")
    .update({ status: "processing", progress: 25, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  try {
    const videoUrl = await renderVerticalVideo(job);
    await supabase
      .from("video_jobs")
      .update({
        status: "completed",
        progress: 100,
        video_url: videoUrl,
        error_message: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id);

    console.log("Tamamlandi:", videoUrl);
  } catch (err) {
    await supabase
      .from("video_jobs")
      .update({
        status: "failed",
        error_message: err.message,
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id);
    throw err;
  }
}

run();
