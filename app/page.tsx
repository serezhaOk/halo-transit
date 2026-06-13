'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export default function Home() {
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [notionUrl, setNotionUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup object URLs when component unmounts or images change
  useEffect(() => {
    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previews]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    const newPreviews = fileArray.map((f) => URL.createObjectURL(f));
    setImages((prev) => [...prev, ...fileArray]);
    setPreviews((prev) => [...prev, ...newPreviews]);
  }, []);

  const removeImage = useCallback(
    (index: number) => {
      URL.revokeObjectURL(previews[index]);
      setImages((prev) => prev.filter((_, i) => i !== index));
      setPreviews((prev) => prev.filter((_, i) => i !== index));
    },
    [previews]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      // Reset file input so same files can be re-added if removed
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleSubmit = async () => {
    if (images.length === 0 || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setNotionUrl(null);

    try {
      const formData = new FormData();
      images.forEach((image) => {
        formData.append('images', image);
      });
      formData.append('notes', notes);

      const response = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate listing');
      }

      setResult(data.description);
      setNotionUrl(data.notionUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="max-w-2xl mx-auto p-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-stone-800 tracking-tight">Halo Transit</h1>
        <p className="text-stone-500 mt-1 text-sm">Etsy listing generator for vintage clothing</p>
      </div>

      {/* Upload Section */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-stone-700 mb-2">Upload photos</label>
        <div
          className={`relative border-2 border-dashed rounded-lg p-4 cursor-pointer transition-colors ${
            isDragging
              ? 'border-amber-500 bg-amber-50'
              : 'border-stone-300 bg-white hover:border-stone-400 hover:bg-stone-50'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          {images.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-stone-400">
              <svg
                className="w-10 h-10 mb-3 text-stone-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm">Click to upload or drag photos here</p>
              <p className="text-xs mt-1 text-stone-300">PNG, JPG, WEBP, GIF supported</p>
            </div>
          ) : (
            <div
              className="grid grid-cols-4 gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              {previews.map((src, index) => (
                <div key={index} className="relative aspect-square group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Upload ${index + 1}`}
                    className="w-full h-full object-cover rounded-md"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(index);
                    }}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                    aria-label="Remove image"
                  >
                    &times;
                  </button>
                </div>
              ))}
              {/* Add more button */}
              <div
                className="aspect-square border-2 border-dashed border-stone-200 rounded-md flex items-center justify-center cursor-pointer hover:border-stone-300 hover:bg-stone-50 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <span className="text-stone-300 text-2xl leading-none">+</span>
              </div>
            </div>
          )}
        </div>
        {images.length > 0 && (
          <p className="text-xs text-stone-400 mt-1">
            {images.length} photo{images.length !== 1 ? 's' : ''} selected
          </p>
        )}
      </div>

      {/* Notes Textarea */}
      <div className="mb-5">
        <label className="block text-sm font-medium text-stone-700 mb-2" htmlFor="notes">
          Your notes
        </label>
        <textarea
          id="notes"
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe what you notice: fabric, defects, construction details, era clues, measurements if you have them..."
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent resize-none transition"
        />
      </div>

      {/* Generate Button */}
      <button
        onClick={handleSubmit}
        disabled={images.length === 0 || loading}
        className="w-full py-3 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg
              className="animate-spin h-4 w-4 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Generating description...
          </>
        ) : (
          'Generate'
        )}
      </button>

      {/* Error Display */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Result Section */}
      {result && (
        <div className="mt-6 space-y-3">
          {/* Notion status badge */}
          <div className="flex items-center gap-2">
            {notionUrl ? (
              <a
                href={notionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-200 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Saved to Notion — view page
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-500">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Notion not configured
              </span>
            )}
          </div>

          {/* Description card */}
          <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
              <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">
                Generated listing
              </span>
              <button
                onClick={handleCopy}
                className="text-xs text-stone-500 hover:text-stone-700 font-medium flex items-center gap-1.5 transition-colors"
              >
                {copied ? (
                  <>
                    <svg className="w-3.5 h-3.5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-green-600">Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    Copy to clipboard
                  </>
                )}
              </button>
            </div>
            <div className="p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm text-stone-700 leading-relaxed">
                {result}
              </pre>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
