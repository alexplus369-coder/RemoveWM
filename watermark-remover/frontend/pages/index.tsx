// pages/index.tsx
import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
type Mode = "image" | "video";
type Status =
  | "idle"
  | "ready"
  | "processing"
  | "done"
  | "error";

interface Selection {
  x: number; y: number; w: number; h: number;
}
interface Progress {
  status: string;
  progress: number;
  total?: number;
  message?: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Component ────────────────────────────────────────────────────────────────
export default function Home() {
  const [mode, setMode]           = useState<Mode>("image");
  const [file, setFile]           = useState<File | null>(null);
  const [preview, setPreview]     = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [status, setStatus]       = useState<Status>("idle");
  const [progress, setProgress]   = useState<Progress | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);

  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const imgRef      = useRef<HTMLImageElement | null>(null);
  const isDrawing   = useRef(false);
  const startPt     = useRef({ x: 0, y: 0 });
  const scaleRef    = useRef({ x: 1, y: 1 });
  const currentSel  = useRef<Selection | null>(null);

  // ── Canvas helpers ──────────────────────────────────────────────────────────
  const renderCanvas = useCallback((sel: Selection | null = null) => {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;

    const MAX_W = 800, MAX_H = 480;
    const scale = Math.min(MAX_W / img.naturalWidth, MAX_H / img.naturalHeight, 1);
    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    scaleRef.current = {
      x: img.naturalWidth  / canvas.width,
      y: img.naturalHeight / canvas.height,
    };

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (sel && sel.w > 2 && sel.h > 2) {
      // Dimmed overlay
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Cutout
      ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Selection frame
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth   = 2;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
      ctx.setLineDash([]);
      // Corner handles
      const cs = 8;
      ctx.fillStyle = "#f97316";
      [[sel.x, sel.y], [sel.x + sel.w - cs, sel.y],
       [sel.x, sel.y + sel.h - cs], [sel.x + sel.w - cs, sel.y + sel.h - cs]]
        .forEach(([cx, cy]) => ctx.fillRect(cx, cy, cs, cs));
      // Label
      ctx.fillStyle = "#f97316";
      ctx.font = "bold 11px 'Courier New', monospace";
      const label = `${Math.round(sel.w * scaleRef.current.x)} × ${Math.round(sel.h * scaleRef.current.y)} px`;
      ctx.fillText(label, sel.x + 4, sel.y - 6 > 10 ? sel.y - 6 : sel.y + 16);
    }
  }, []);

  const getCanvasPoint = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    };
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (status === "processing") return;
    isDrawing.current = true;
    startPt.current   = getCanvasPoint(e);
    setSelection(null);
    currentSel.current = null;
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const pt = getCanvasPoint(e);
    const sel: Selection = {
      x: Math.min(startPt.current.x, pt.x),
      y: Math.min(startPt.current.y, pt.y),
      w: Math.abs(pt.x - startPt.current.x),
      h: Math.abs(pt.y - startPt.current.y),
    };
    currentSel.current = sel;
    renderCanvas(sel);
  };

  const onMouseUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    if (currentSel.current && currentSel.current.w > 4 && currentSel.current.h > 4) {
      setSelection(currentSel.current);
      setStatus("ready");
    }
  };

  // ── File handling ───────────────────────────────────────────────────────────
  const handleFile = (f: File) => {
    setFile(f);
    setSelection(null);
    setResultUrl(null);
    setErrorMsg(null);
    setProgress(null);
    setStatus("idle");
    currentSel.current = null;

    const url = URL.createObjectURL(f);
    setPreview(url);

    if (mode === "image") {
      const img   = new Image();
      img.onload  = () => { imgRef.current = img; renderCanvas(null); };
      img.src     = url;
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  // ── Process ─────────────────────────────────────────────────────────────────
  const process = async () => {
    if (!file || (!selection && mode === "image")) return;
    setStatus("processing");
    setResultUrl(null);
    setErrorMsg(null);

    const sel = selection!;
    const realX = Math.round(sel.x * scaleRef.current.x);
    const realY = Math.round(sel.y * scaleRef.current.y);
    const realW = Math.round(sel.w * scaleRef.current.x);
    const realH = Math.round(sel.h * scaleRef.current.y);

    const fd = new FormData();
    fd.append("file",   file);
    fd.append("x",      realX.toString());
    fd.append("y",      realY.toString());
    fd.append("width",  realW.toString());
    fd.append("height", realH.toString());

    try {
      if (mode === "image") {
        setProgress({ status: "Procesando imagen…", progress: 0 });
        const res  = await fetch(`${API}/remove-watermark-image`, { method: "POST", body: fd });
        if (!res.ok) throw new Error(`Error del servidor: ${res.status}`);
        const blob = await res.blob();
        setResultUrl(URL.createObjectURL(blob));
        setStatus("done");
        setProgress(null);
      } else {
        // Video: start job → SSE progress
        const startRes  = await fetch(`${API}/remove-watermark-video/start`, { method: "POST", body: fd });
        if (!startRes.ok) throw new Error(`Error al iniciar: ${startRes.status}`);
        const { job_id } = await startRes.json();

        const evtSrc = new EventSource(`${API}/progress/${job_id}`);
        evtSrc.onmessage = (e) => {
          const data: Progress & { result_path?: string } = JSON.parse(e.data);
          setProgress(data);
          if (data.status === "done") {
            evtSrc.close();
            setResultUrl(`${API}/result/${job_id}`);
            setStatus("done");
          } else if (data.status === "error") {
            evtSrc.close();
            setErrorMsg(data.message ?? "Error desconocido");
            setStatus("error");
          }
        };
        evtSrc.onerror = () => {
          evtSrc.close();
          setErrorMsg("Se perdió la conexión con el servidor.");
          setStatus("error");
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStatus("error");
    }
  };

  // Re-render canvas when mode changes
  useEffect(() => {
    if (mode === "image" && imgRef.current) renderCanvas(selection);
  }, [mode, renderCanvas, selection]);

  // ── UI ──────────────────────────────────────────────────────────────────────
  const progressPct = progress?.total
    ? Math.round((progress.progress / progress.total) * 100)
    : null;

  const statusLabels: Record<string, string> = {
    extracting: "Extrayendo fotogramas…",
    processing: `Procesando fotogramas… ${progressPct != null ? progressPct + "%" : ""}`,
    encoding:   "Recodificando vídeo con audio…",
    done:       "¡Listo!",
    error:      "Error",
    queued:     "En cola…",
  };

  return (
    <div style={styles.root}>
      {/* ── Header ── */}
      <header style={styles.header}>
        <span style={styles.logo}>⬛ CLEARMARK</span>
        <p style={styles.tagline}>Eliminador de marcas de agua · LaMa Inpainting · Código abierto</p>
      </header>

      <main style={styles.main}>
        {/* ── Mode toggle ── */}
        <div style={styles.modeRow}>
          {(["image", "video"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setFile(null); setPreview(null); setSelection(null); setStatus("idle"); setResultUrl(null); }}
              style={{ ...styles.modeBtn, ...(mode === m ? styles.modeBtnActive : {}) }}
            >
              {m === "image" ? "🖼  Imagen" : "🎬  Vídeo"}
            </button>
          ))}
        </div>

        {/* ── Drop zone ── */}
        {!file && (
          <div
            style={styles.dropZone}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div style={styles.dropIcon}>{mode === "image" ? "🖼" : "🎬"}</div>
            <p style={styles.dropText}>Arrastra aquí tu archivo o haz clic</p>
            <p style={styles.dropHint}>{mode === "image" ? "PNG, JPG, WEBP" : "MP4, MOV, MKV"}</p>
            <label style={styles.browseBtn}>
              Seleccionar archivo
              <input
                type="file"
                accept={mode === "image" ? "image/*" : "video/*"}
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </label>
          </div>
        )}

        {/* ── Canvas (imagen) ── */}
        {file && mode === "image" && (
          <div style={styles.canvasWrapper}>
            <p style={styles.hint}>
              {selection
                ? "✅ Región seleccionada. Puedes ajustarla o procesar."
                : "👆 Arrastra sobre la marca de agua para seleccionar la región."}
            </p>
            <canvas
              ref={canvasRef}
              style={{ ...styles.canvas, cursor: status === "processing" ? "not-allowed" : "crosshair" }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            />
          </div>
        )}

        {/* ── Video preview ── */}
        {file && mode === "video" && preview && (
          <div style={styles.videoPreviewWrap}>
            <video src={preview} style={styles.videoPreview} controls muted />
            <div style={styles.hint}>
              💡 Para vídeo introduce las coordenadas de la marca manualmente.
            </div>
            <div style={styles.coordRow}>
              {(["x","y","w","h"] as const).map((k, i) => (
                <label key={k} style={styles.coordLabel}>
                  <span style={styles.coordName}>
                    {["X","Y","Ancho","Alto"][i]}
                  </span>
                  <input
                    type="number"
                    min={0}
                    style={styles.coordInput}
                    value={selection ? (selection as Record<string,number>)[k] : ""}
                    onChange={(e) =>
                      setSelection((s) => ({
                        x: 0, y: 0, w: 100, h: 40, ...s,
                        [k]: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                </label>
              ))}
              <button style={styles.coordSet} onClick={() => setStatus("ready")}>
                Confirmar
              </button>
            </div>
          </div>
        )}

        {/* ── Process button ── */}
        {file && (
          <div style={styles.actionRow}>
            <button
              style={{
                ...styles.processBtn,
                ...(status === "processing" || !selection ? styles.processBtnDisabled : {}),
              }}
              onClick={process}
              disabled={status === "processing" || !selection}
            >
              {status === "processing"
                ? "Procesando…"
                : mode === "image"
                ? "🧹 Eliminar marca de agua"
                : "🧹 Procesar vídeo"}
            </button>
            <button
              style={styles.resetBtn}
              onClick={() => { setFile(null); setPreview(null); setSelection(null); setStatus("idle"); setResultUrl(null); setErrorMsg(null); setProgress(null); imgRef.current = null; }}
            >
              ✕ Nuevo archivo
            </button>
          </div>
        )}

        {/* ── Progress bar (video) ── */}
        {status === "processing" && mode === "video" && progress && (
          <div style={styles.progressWrap}>
            <p style={styles.progressLabel}>
              {statusLabels[progress.status] ?? progress.status}
            </p>
            {progressPct != null && (
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
              </div>
            )}
            {progress.total != null && (
              <p style={styles.progressSub}>
                Fotograma {progress.progress} / {progress.total}
              </p>
            )}
          </div>
        )}

        {/* ── Image processing indicator ── */}
        {status === "processing" && mode === "image" && (
          <div style={styles.progressWrap}>
            <p style={styles.progressLabel}>Aplicando LaMa Inpainting…</p>
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressFill, width: "100%", animation: "pulse 1.5s ease-in-out infinite" }} />
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {errorMsg && (
          <div style={styles.errorBox}>
            ⚠️ {errorMsg}
          </div>
        )}

        {/* ── Result ── */}
        {status === "done" && resultUrl && (
          <div style={styles.resultWrap}>
            <h2 style={styles.resultTitle}>✅ Resultado</h2>
            {mode === "image" ? (
              <img src={resultUrl} alt="Resultado" style={styles.resultImg} />
            ) : (
              <video src={resultUrl} style={styles.resultImg} controls />
            )}
            <a href={resultUrl} download="resultado" style={styles.downloadBtn}>
              ⬇ Descargar
            </a>
          </div>
        )}
      </main>

      <footer style={styles.footer}>
        Construido con{" "}
        <a href="https://github.com/Sanster/IOPaint" style={styles.link}>IOPaint (LaMa)</a>
        {" · "}
        <a href="https://fastapi.tiangolo.com" style={styles.link}>FastAPI</a>
        {" · "}
        <a href="https://nextjs.org" style={styles.link}>Next.js</a>
        {" — 100% código abierto"}
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Instrument+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0d; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "#0d0d0d",
    color: "#e8e8e8",
    fontFamily: "'Instrument Sans', sans-serif",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    padding: "28px 40px 20px",
    borderBottom: "1px solid #1e1e1e",
  },
  logo: {
    fontFamily: "'Space Mono', monospace",
    fontWeight: 700,
    fontSize: "20px",
    letterSpacing: "0.08em",
    color: "#f97316",
  },
  tagline: {
    fontSize: "12px",
    color: "#555",
    marginTop: "4px",
    fontFamily: "'Space Mono', monospace",
  },
  main: {
    flex: 1,
    maxWidth: "900px",
    width: "100%",
    margin: "0 auto",
    padding: "40px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  },
  modeRow: {
    display: "flex",
    gap: "10px",
  },
  modeBtn: {
    padding: "10px 24px",
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: "6px",
    color: "#888",
    fontSize: "14px",
    cursor: "pointer",
    fontFamily: "'Instrument Sans', sans-serif",
    transition: "all 0.15s",
  },
  modeBtnActive: {
    background: "#1c1410",
    border: "1px solid #f97316",
    color: "#f97316",
  },
  dropZone: {
    border: "2px dashed #2a2a2a",
    borderRadius: "12px",
    padding: "60px 40px",
    textAlign: "center",
    transition: "border-color 0.2s",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
  },
  dropIcon: { fontSize: "48px" },
  dropText: { fontSize: "16px", color: "#ccc" },
  dropHint: { fontSize: "12px", color: "#555", fontFamily: "'Space Mono', monospace" },
  browseBtn: {
    marginTop: "8px",
    padding: "10px 24px",
    background: "#f97316",
    color: "#000",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
  },
  canvasWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  canvas: {
    borderRadius: "8px",
    border: "1px solid #2a2a2a",
    userSelect: "none",
    maxWidth: "100%",
  },
  hint: {
    fontSize: "13px",
    color: "#888",
    fontFamily: "'Space Mono', monospace",
  },
  videoPreviewWrap: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  videoPreview: {
    width: "100%",
    borderRadius: "8px",
    border: "1px solid #2a2a2a",
    maxHeight: "400px",
  },
  coordRow: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    alignItems: "flex-end",
  },
  coordLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  coordName: {
    fontSize: "11px",
    color: "#888",
    fontFamily: "'Space Mono', monospace",
    textTransform: "uppercase",
  },
  coordInput: {
    width: "90px",
    padding: "8px 10px",
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: "6px",
    color: "#e8e8e8",
    fontSize: "14px",
    fontFamily: "'Space Mono', monospace",
  },
  coordSet: {
    padding: "8px 18px",
    background: "#f97316",
    border: "none",
    borderRadius: "6px",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "13px",
    alignSelf: "flex-end",
  },
  actionRow: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
  },
  processBtn: {
    padding: "14px 32px",
    background: "#f97316",
    border: "none",
    borderRadius: "8px",
    color: "#000",
    fontSize: "15px",
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "0.02em",
  },
  processBtnDisabled: {
    background: "#3a2a1a",
    color: "#6a5a4a",
    cursor: "not-allowed",
  },
  resetBtn: {
    padding: "14px 20px",
    background: "transparent",
    border: "1px solid #2a2a2a",
    borderRadius: "8px",
    color: "#666",
    fontSize: "14px",
    cursor: "pointer",
  },
  progressWrap: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    padding: "20px",
    background: "#141414",
    borderRadius: "8px",
    border: "1px solid #2a2a2a",
  },
  progressLabel: {
    fontSize: "13px",
    color: "#f97316",
    fontFamily: "'Space Mono', monospace",
  },
  progressTrack: {
    height: "6px",
    background: "#2a2a2a",
    borderRadius: "3px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, #f97316, #fbbf24)",
    borderRadius: "3px",
    transition: "width 0.3s ease",
  },
  progressSub: {
    fontSize: "12px",
    color: "#555",
    fontFamily: "'Space Mono', monospace",
  },
  errorBox: {
    padding: "16px 20px",
    background: "#1e0a0a",
    border: "1px solid #7f1d1d",
    borderRadius: "8px",
    color: "#f87171",
    fontSize: "13px",
    fontFamily: "'Space Mono', monospace",
  },
  resultWrap: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  resultTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#a3e635",
  },
  resultImg: {
    width: "100%",
    borderRadius: "8px",
    border: "1px solid #2a2a2a",
    maxHeight: "500px",
    objectFit: "contain",
    background: "#141414",
  },
  downloadBtn: {
    display: "inline-block",
    padding: "12px 28px",
    background: "#a3e635",
    color: "#0d0d0d",
    borderRadius: "8px",
    fontWeight: 700,
    textDecoration: "none",
    fontSize: "14px",
    alignSelf: "flex-start",
  },
  footer: {
    padding: "20px 40px",
    borderTop: "1px solid #1e1e1e",
    fontSize: "12px",
    color: "#444",
    fontFamily: "'Space Mono', monospace",
    textAlign: "center",
  },
  link: { color: "#f97316", textDecoration: "none" },
};
