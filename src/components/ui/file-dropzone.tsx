'use client';

import {
    Cancel01Icon,
    CloudUploadIcon,
    File01Icon,
    FileUploadIcon,
    Upload01Icon,
} from '@hugeicons/core-free-icons';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useCallback, useId, useState } from 'react';

import Icon from '@/components/icon';
import { cn } from '@/lib/utils';

/**
 * A file awaiting ingestion, captured locally only.
 *
 * This prototype never uploads anything to a server — `file` stays in memory
 * and `preview` is an object URL revoked when the file is removed.
 */
export interface DroppedFile {
    id: string;
    file: File;
    preview?: string;
}

export interface FileDropzoneProps {
    /** Called whenever the local file set changes (added or removed). */
    onFilesDropped: (files: DroppedFile[]) => void;
    accept?: string;
    multiple?: boolean;
    /** Max size per file in bytes. */
    maxSize?: number;
    maxFiles?: number;
    disabled?: boolean;
    className?: string;
    /** Optional custom inner content; otherwise the default idle/drag UI is rendered. */
    children?: ReactNode;
    /** Human-readable list surfaced in the idle hints ("PDF, PNG, …"). */
    acceptedFileTypes?: string[];
    initialFiles?: DroppedFile[];
}

/**
 * Drag-and-drop file ingestion surface.
 *
 * Project alignment notes:
 * - Pure client surface. There is no TanStack Start server function to call:
 *   file ingestion only stages files locally in this prototype. Real ingestion
 *   ships with the source-acquisition slice.
 * - No `next/image`: the workspace is a React + TanStack Start module bundle,
 *   not a Next app — previews use a native `<img>` and the object URL is
 *   revoked on removal to avoid leaks.
 * - Colors come from semantic tokens only (no hard-coded zinc/red), so the
 *   component tracks the active theme (light/dark) automatically.
 * - Animation goes through `motion/react` (the project's standard motion
 *   library) with `useReducedMotion` honoring the accessibility preference.
 */
export function FileDropzone({
    onFilesDropped,
    accept,
    multiple = true,
    maxSize = 10 * 1024 * 1024, // 10MB default
    maxFiles = 10,
    disabled = false,
    className,
    children,
    acceptedFileTypes = ['*'],
    initialFiles = [],
}: FileDropzoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [files, setFiles] = useState<DroppedFile[]>(initialFiles);
    const [error, setError] = useState<string | null>(null);
    const reducedMotion = useReducedMotion();
    const inputId = useId();

    const generateId = useCallback(
        () => Math.random().toString(36).substring(2, 9),
        [],
    );

    const emit = useCallback(
        (next: DroppedFile[]) => {
            setFiles(next);
            onFilesDropped(next);
        },
        [onFilesDropped],
    );

    const processFiles = useCallback(
        (fileList: FileList | File[]) => {
            setError(null);
            const incoming = Array.from(fileList);

            if (!multiple && incoming.length > 1) {
                setError('Only one file allowed');
                return;
            }

            if (files.length + incoming.length > maxFiles) {
                setError(`Maximum ${maxFiles} files allowed`);
                return;
            }

            const acceptedFiles: DroppedFile[] = [];
            for (const file of incoming) {
                if (maxSize && file.size > maxSize) {
                    setError(
                        `File ${file.name} exceeds ${Math.round(maxSize / 1024 / 1024)}MB limit`,
                    );
                    continue;
                }
                acceptedFiles.push({
                    id: generateId(),
                    file,
                    preview: file.type.startsWith('image/')
                        ? URL.createObjectURL(file)
                        : undefined,
                });
            }

            if (acceptedFiles.length > 0) {
                emit(multiple ? [...files, ...acceptedFiles] : acceptedFiles);
            }
        },
        [emit, files, generateId, maxFiles, maxSize, multiple],
    );

    const removeFile = useCallback(
        (id: string) => {
            const target = files.find((f) => f.id === id);
            if (target?.preview) {
                URL.revokeObjectURL(target.preview);
            }
            emit(files.filter((f) => f.id !== id));
        },
        [emit, files],
    );

    const handleDragOver = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            if (!disabled) setIsDragging(true);
        },
        [disabled],
    );

    const handleDragLeave = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            setIsDragging(false);
            if (!disabled && event.dataTransfer.files.length > 0) {
                processFiles(event.dataTransfer.files);
            }
        },
        [disabled, processFiles],
    );

    const handleInputChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            if (event.target.files && event.target.files.length > 0) {
                processFiles(event.target.files);
            }
        },
        [processFiles],
    );

    const acceptedTypesLabel = acceptedFileTypes.includes('*')
        ? 'All file types'
        : acceptedFileTypes.join(', ');

    return (
        <div className={cn('space-y-3', className)}>
            {/* Dropzone surface */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard access is provided by the labelled file input below */}
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    'relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-200',
                    isDragging
                        ? 'border-primary bg-primary/5 shadow-floating'
                        : 'border-border bg-muted/30 hover:border-border/70',
                    disabled && 'cursor-not-allowed opacity-50',
                    !isDragging && 'p-8',
                )}
            >
                <label
                    htmlFor={inputId}
                    className="absolute inset-0 z-10 cursor-pointer"
                >
                    <span className="sr-only">Browse files</span>
                </label>
                <input
                    id={inputId}
                    type="file"
                    accept={accept}
                    multiple={multiple}
                    onChange={handleInputChange}
                    disabled={disabled}
                    className="sr-only"
                />

                {children ?? (
                    <AnimatePresence mode="wait" initial={false}>
                        {isDragging ? (
                            <motion.div
                                key="dragging"
                                className="flex w-full flex-col items-center justify-center p-8 text-center"
                                initial={
                                    reducedMotion
                                        ? false
                                        : { opacity: 0, scale: 0.95 }
                                }
                                animate={
                                    reducedMotion
                                        ? { opacity: 1 }
                                        : { opacity: 1, scale: 1 }
                                }
                                exit={
                                    reducedMotion
                                        ? { opacity: 0 }
                                        : { opacity: 0, scale: 0.95 }
                                }
                                transition={{ duration: 0.2 }}
                            >
                                <motion.div
                                    className="mb-5 flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary"
                                    animate={
                                        reducedMotion
                                            ? undefined
                                            : {
                                                  y: [0, -10, 0],
                                                  scale: [1, 1.05, 1],
                                              }
                                    }
                                    transition={
                                        reducedMotion
                                            ? undefined
                                            : {
                                                  repeat: Number.POSITIVE_INFINITY,
                                                  duration: 2,
                                                  ease: 'easeInOut',
                                              }
                                    }
                                >
                                    <Icon
                                        iconNode={Upload01Icon}
                                        size={36}
                                        strokeWidth={1.5}
                                    />
                                </motion.div>

                                <h3 className="mb-2 text-2xl font-bold text-foreground">
                                    Drop files here
                                </h3>
                                <p className="mb-4 text-muted-foreground">
                                    Release to stage them with the dossier
                                </p>

                                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-secondary-foreground">
                                        <Icon
                                            iconNode={FileUploadIcon}
                                            size={12}
                                        />
                                        Max {Math.round(maxSize / 1024 / 1024)}
                                        MB
                                    </span>
                                    <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-secondary-foreground">
                                        <Icon iconNode={File01Icon} size={12} />
                                        {acceptedTypesLabel}
                                    </span>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="idle"
                                className="flex flex-col items-center justify-center"
                                initial={reducedMotion ? false : { opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ duration: 0.2 }}
                            >
                                <Icon
                                    iconNode={CloudUploadIcon}
                                    size={40}
                                    className="mb-3 text-muted-foreground"
                                />
                                <p className="text-sm font-medium text-foreground">
                                    Drag &amp; drop files here
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    or click to browse
                                </p>
                                {maxSize ? (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        Max {Math.round(maxSize / 1024 / 1024)}
                                        MB per file
                                    </p>
                                ) : null}
                            </motion.div>
                        )}
                    </AnimatePresence>
                )}
            </div>

            {error ? (
                <p
                    role="alert"
                    className="text-sm text-destructive dark:text-destructive/90"
                >
                    {error}
                </p>
            ) : null}

            {files.length > 0 ? (
                <ul className="flex flex-wrap gap-2" aria-label="Staged files">
                    {files.map((file) => (
                        <li
                            key={file.id}
                            className="group relative flex items-center gap-2 rounded-lg bg-muted/60 p-2 pr-8"
                        >
                            {file.preview ? (
                                <img
                                    src={file.preview}
                                    alt={file.file.name}
                                    className="size-10 rounded object-cover"
                                />
                            ) : (
                                <span className="flex size-10 items-center justify-center rounded bg-muted">
                                    <Icon
                                        iconNode={File01Icon}
                                        size={20}
                                        className="text-muted-foreground"
                                    />
                                </span>
                            )}
                            <div className="min-w-0">
                                <p className="max-w-32 truncate text-sm font-medium text-foreground">
                                    {file.file.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {(file.file.size / 1024).toFixed(1)} KB
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => removeFile(file.id)}
                                aria-label={`Remove ${file.file.name}`}
                                className="absolute top-1 right-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                            >
                                <Icon iconNode={Cancel01Icon} size={12} />
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}
