"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square } from "lucide-react";

type Props = {
  onTranscript: (text: string) => void;
  onStatus: (text: string) => void;
};

export function AudioRecorder({ onTranscript, onStatus }: Props) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);

  const cleanupStream = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const uploadAudio = async (blob: Blob) => {
    setUploading(true);
    onStatus("Transcribing audio…");

    try {
      const ext = blob.type.includes("wav")
        ? "wav"
        : blob.type.includes("mp4") || blob.type.includes("m4a")
        ? "m4a"
        : "webm";

      const file = new File([blob], `quikado-audio.${ext}`, {
        type: blob.type || "audio/webm",
      });

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/audio/transcribe", {
        method: "POST",
        body: formData,
      });

      const json = await res.json().catch(() => null);

      if (res.status === 202 && json?.review) {
        onStatus(json?.error ?? "Audio transcript is under review.");
        return;
      }

      if (!res.ok) {
        onStatus(json?.error ?? "Audio transcription failed.");
        return;
      }

      const transcript = (json?.transcript ?? "").trim();
      if (!transcript) {
        onStatus("No speech detected. Please try again.");
        return;
      }

      onTranscript(transcript);
      onStatus("Audio added to prompt ✅");
    } catch (e: any) {
      onStatus(e?.message ?? "Audio upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const startRecording = async () => {
    try {
      if (
        typeof window === "undefined" ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        onStatus("Audio recording is not supported in this browser.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      let mimeType = "";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      }

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const finalType =
          recorder.mimeType && recorder.mimeType.length > 0
            ? recorder.mimeType
            : "audio/webm";

        const blob = new Blob(chunksRef.current, { type: finalType });
        cleanupStream();
        await uploadAudio(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      onStatus("Recording… tap stop when done.");
    } catch {
      cleanupStream();
      onStatus("Microphone permission denied or unavailable.");
    }
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  return recording ? (
    <Button
      type="button"
      variant="secondary"
      className="rounded-xl"
      onClick={stopRecording}
      disabled={uploading}
    >
      <Square className="mr-2 h-4 w-4" />
      Stop
    </Button>
  ) : (
    <Button
      type="button"
      variant="secondary"
      className="rounded-xl"
      onClick={startRecording}
      disabled={uploading}
    >
      <Mic className="mr-2 h-4 w-4" />
      {uploading ? "Processing…" : "Audio"}
    </Button>
  );
}