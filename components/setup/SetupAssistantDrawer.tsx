"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import ReactMarkdown from "react-markdown";
import { ImagePlus, Send, Sparkles, Trash2, X } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

const MAX_IMAGES_PER_MESSAGE = 4;

const QUICK_PROMPTS = [
  "O carro está saindo de frente na entrada da curva. O que ajustar?",
  "Como melhorar a tração na saída sem deixar a traseira solta?",
  "O que mudar para ter mais estabilidade na freada?",
  "Analise o print do meu setup atual e sugira melhorias.",
];

async function compressImageFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Arquivo inválido: selecione uma imagem.");
  }

  const readFallback = () =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler imagem."));
      reader.readAsDataURL(file);
    });

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Não foi possível carregar a imagem."));
      el.src = objectUrl;
    });

    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round((img.width || maxDim) * scale));
    const height = Math.max(1, Math.round((img.height || maxDim) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return await readFallback();
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.84);
  } catch {
    return await readFallback();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function SetupAssistantDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isSending, open]);

  if (!open) return null;

  async function handleAddFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!list.length) return;
    const available = MAX_IMAGES_PER_MESSAGE - pendingImages.length;
    if (available <= 0) {
      setError(`Máximo de ${MAX_IMAGES_PER_MESSAGE} imagens por mensagem.`);
      return;
    }
    setError(null);
    try {
      const encoded = await Promise.all(list.slice(0, available).map(compressImageFile));
      setPendingImages((prev) => [...prev, ...encoded].slice(0, MAX_IMAGES_PER_MESSAGE));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao processar imagem.");
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      void handleAddFiles(files);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
      setIsDragging(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget === event.target) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer?.files?.length) {
      void handleAddFiles(event.dataTransfer.files);
    }
  }

  async function sendPrompt(rawText: string) {
    const text = rawText.trim();
    const imagesToSend = [...pendingImages];
    if ((!text && imagesToSend.length === 0) || isSending) return;

    setError(null);
    const nextHistory: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: text || "Analise as imagens enviadas.",
        ...(imagesToSend.length > 0 ? { images: imagesToSend } : {}),
      },
    ];
    setMessages(nextHistory);
    setInput("");
    setPendingImages([]);
    setIsSending(true);

    try {
      const response = await fetch("/api/setup/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextHistory }),
      });
      const payload = (await response.json()) as { status?: string; reply?: string; message?: string };
      if (!response.ok || payload.status !== "ok" || !payload.reply) {
        throw new Error(payload.message ?? "Não foi possível consultar o assistente agora.");
      }
      setMessages((prev) => [...prev, { role: "assistant", content: payload.reply! }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao consultar o assistente.");
    } finally {
      setIsSending(false);
    }
  }

  const contextLabel = "Chatbot geral · independente de carro e pista";

  return (
    <div className="ngsa-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assistente IA de Setup"
        className={`ngsa-drawer${isDragging ? " ngsa-dragging" : ""}`}
        onClick={(event) => event.stopPropagation()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="ngsa-head">
          <div className="ngsa-head-info">
            <div className="ngsa-head-title">
              <Sparkles size={15} />
              <h2>Assistente IA</h2>
            </div>
            <p className="ngsa-head-sub" title={contextLabel}>{contextLabel}</p>
          </div>
          <div className="ngsa-head-actions">
            {messages.length > 0 && (
              <button
                type="button"
                className="ngsa-icon-btn"
                onClick={() => { setMessages([]); setError(null); }}
                title="Limpar conversa"
                aria-label="Limpar conversa"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button
              type="button"
              className="ngsa-icon-btn"
              onClick={onClose}
              title="Fechar assistente"
              aria-label="Fechar assistente"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="ngsa-body">
          {messages.length === 0 && (
            <div className="ngsa-welcome">
              <p className="ngsa-welcome-title">Chatbot geral de Setup e iRacing</p>
              <p className="ngsa-welcome-desc">
                Independente do carro e pista selecionados acima. Tire dúvidas livres de engenharia, compare conceitos ou cole prints (`Ctrl+V`) de qualquer setup.
              </p>
              <div className="ngsa-quick-list">
                {QUICK_PROMPTS.map((prompt) => (
                  <button key={prompt} type="button" className="ngsa-quick-btn" onClick={() => void sendPrompt(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={index} className="ngsa-msg-wrap" data-role={message.role}>
              <div className="ngsa-bubble" data-role={message.role}>
                {message.images && message.images.length > 0 && (
                  <div className="ngsa-msg-images">
                    {message.images.map((src, imgIdx) => (
                      <img key={imgIdx} src={src} alt={`Print anexado ${imgIdx + 1}`} />
                    ))}
                  </div>
                )}
                {message.role === "assistant" ? (
                  <div className="ngs-markdown">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                ) : (
                  <span>{message.content}</span>
                )}
              </div>
            </div>
          ))}

          {isSending && (
            <div className="ngsa-typing">Pensando…</div>
          )}

          {error && (
            <div className="ngsa-error" role="alert">{error}</div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {pendingImages.length > 0 && (
          <div className="ngsa-pending-images">
            {pendingImages.map((src, idx) => (
              <div key={idx} className="ngsa-pending-thumb">
                <img src={src} alt={`Imagem pendente ${idx + 1}`} />
                <button
                  type="button"
                  aria-label="Remover imagem"
                  onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form
          className="ngsa-footer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendPrompt(input);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void handleAddFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="ngsa-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending || pendingImages.length >= MAX_IMAGES_PER_MESSAGE}
            title="Enviar print do setup (ou cole com Ctrl+V)"
            aria-label="Enviar imagem"
          >
            <ImagePlus size={16} />
          </button>
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handlePaste}
            placeholder="Pergunte algo ou cole um print (Ctrl+V)…"
            disabled={isSending}
            className="ngsa-input"
          />
          <button
            type="submit"
            disabled={isSending || (!input.trim() && pendingImages.length === 0)}
            className="ng-button ngsa-send-btn"
            aria-label="Enviar mensagem"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
