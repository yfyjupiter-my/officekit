"use client"

import { useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"

type DropZoneProps = {
  disabled?: boolean
  hasFiles?: boolean
  onPickFiles: (files: FileList) => void
  accept?: string
  multiple?: boolean
  inputId: string
}

export function DropZone({
  disabled = false,
  hasFiles = false,
  onPickFiles,
  accept,
  multiple,
  inputId,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const dragDepth = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!disabled) return
    dragDepth.current = 0
    setIsDragging(false)
  }, [disabled])

  function openPicker() {
    if (disabled) return
    inputRef.current?.click()
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.files
          if (!next || next.length === 0) return
          onPickFiles(next)
          event.currentTarget.value = ""
        }}
        className="sr-only"
      />

      <div
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openPicker()
          }
        }}
        onDragEnter={(event) => {
          if (disabled) return
          event.preventDefault()
          dragDepth.current += 1
          setIsDragging(true)
        }}
        onDragOver={(event) => {
          if (disabled) return
          event.preventDefault()
        }}
        onDragLeave={(event) => {
          if (disabled) return
          event.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setIsDragging(false)
        }}
        onDrop={(event) => {
          if (disabled) return
          event.preventDefault()
          dragDepth.current = 0
          setIsDragging(false)
          const next = event.dataTransfer.files
          if (!next || next.length === 0) return
          onPickFiles(next)
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-8 text-center transition-colors duration-150 focus:border-muji-accent focus:outline-none ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"
        } ${hasFiles ? "py-4" : "py-12"} ${
          isDragging
            ? "border-muji-accent bg-muji-bg-hover"
            : "border-muji-border bg-muji-bg-card hover:bg-muji-bg-hover"
        }`}
      >
        {hasFiles ? (
          <p className="text-sm text-muji-text-secondary">Add more files</p>
        ) : (
          <>
            <Upload
              className={`h-6 w-6 ${isDragging ? "text-muji-accent" : "text-muji-text-muted"}`}
              strokeWidth={1.5}
            />
            <p className="text-sm text-muji-text-secondary">Drop files here</p>
            <p className="text-xs leading-loose text-muji-text-muted">or click to browse</p>
          </>
        )}
      </div>
    </div>
  )
}
