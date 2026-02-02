import { useCallback, useState } from 'react';
import { Upload, Video, Music, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  type: 'video' | 'audio';
  file: File | null;
  onFileChange: (file: File | null) => void;
  optional?: boolean;
}

export function FileUpload({ type, file, onFileChange, optional }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      onFileChange(files[0]);
    }
  }, [onFileChange]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileChange(e.target.files[0]);
    }
  };

  const Icon = type === 'video' ? Video : Music;
  const accept = type === 'video' ? 'video/*' : 'audio/*';
  const label = type === 'video' ? 'Video File' : 'Audio File';

  if (file) {
    return (
      <div className="segment-card flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground">
            {(file.size / (1024 * 1024)).toFixed(2)} MB
          </p>
        </div>
        <button
          onClick={() => onFileChange(null)}
          className="p-1.5 rounded-md hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'file-drop-zone p-6 text-center',
        isDragging && 'active'
      )}
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
        id={`file-${type}`}
      />
      <label htmlFor={`file-${type}`} className="cursor-pointer block">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {label} {optional && <span className="text-muted-foreground">(optional)</span>}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Drag & drop or click to browse
            </p>
          </div>
        </div>
      </label>
    </div>
  );
}
