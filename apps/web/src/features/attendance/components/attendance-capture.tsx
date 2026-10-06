import { useEffect, useState, type MouseEvent } from 'react';
import { ExternalLink, ImageOff, MapPin, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/display';
import { fetchObjectUrl, openFile, toApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AttendanceBase, GeoPoint } from '../api';
import { formatTimeIn, mapLink } from '../lib';

const hasCoords = (p?: GeoPoint | null): p is GeoPoint & { latitude: number; longitude: number } =>
  typeof p?.latitude === 'number' && typeof p?.longitude === 'number';

/** 85 m · 1.2 km · 14 km */
const distanceLabel = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`);

/** Where a clock-in/out happened relative to the employee's office: "At office · 40 m", "Outside office · 2.4 km". */
export const PlaceBadge = ({ point }: { point?: GeoPoint | null }) => {
  if (!hasCoords(point)) return <Badge tone="gray">No location</Badge>;
  const distance = typeof point.distanceMeters === 'number' ? distanceLabel(point.distanceMeters) : null;
  const office = point.officeName ? ` (${point.officeName})` : '';
  if (point.withinOffice === true) {
    return (
      <Badge tone="green" dot>
        <span title={`Within the office area${office}${distance ? `, ${distance} from it` : ''}`}>At office{distance ? ` · ${distance}` : ''}</span>
      </Badge>
    );
  }
  if (point.withinOffice === false) {
    return (
      <Badge tone="amber" dot>
        <span title={`Outside the office area${office}${distance ? `, ${distance} away` : ''}`}>Outside office{distance ? ` · ${distance}` : ''}</span>
      </Badge>
    );
  }
  // Office without a geofence radius (distance only) or without coordinates (GPS only).
  return (
    <Badge tone="blue">
      <span title={distance ? `No office area set${office}; distance only` : 'The office has no coordinates set'}>{distance ? `${distance} from office` : 'GPS recorded'}</span>
    </Badge>
  );
};

/** Table cell: the office badge and, underneath, the street address of the point. */
export const PlaceCell = ({ point }: { point?: GeoPoint | null }) => (
  <span className="flex max-w-[16rem] flex-col items-start gap-0.5">
    <PlaceBadge point={point} />
    {point?.address ? (
      <span className="w-full truncate text-xs text-muted" title={point.address}>
        {point.address}
      </span>
    ) : null}
  </span>
);

const openPhoto = (fileId: string) => (e: MouseEvent) => {
  e.stopPropagation();
  openFile(`/files/${fileId}`).catch((err: unknown) => toast.error(toApiError(err).message));
};

/** Selfie thumbnail loaded through the authenticated file endpoint; opens the full image on click. */
export const SelfieThumb = ({ fileId, label, size = 'sm' }: { fileId: string; label: string; size?: 'sm' | 'lg' }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchObjectUrl(`/api/v1/files/${fileId}`)
      .then((u) => {
        objectUrl = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);
  const dims = size === 'lg' ? 'h-20 w-20 rounded-xl' : 'h-8 w-8 rounded-lg';
  return (
    <button
      type="button"
      onClick={openPhoto(fileId)}
      aria-label={`Open ${label}`}
      title={label}
      className={cn('relative shrink-0 overflow-hidden border border-line bg-surface-3 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none', dims)}
    >
      {url ? (
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted">
          {failed ? <ImageOff className="h-4 w-4" aria-hidden /> : <UserRound className="h-4 w-4 animate-pulse" aria-hidden />}
        </span>
      )}
    </button>
  );
};

/** Compact table cell: in/out selfie thumbnails and a location marker. */
export const CaptureCell = ({ record }: { record: AttendanceBase }) => {
  const loc = hasCoords(record.checkInLocation) ? record.checkInLocation : hasCoords(record.checkOutLocation) ? record.checkOutLocation : null;
  if (!record.checkInPhotoId && !record.checkOutPhotoId && !loc) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {record.checkInPhotoId && <SelfieThumb fileId={record.checkInPhotoId} label="Clock-in selfie" />}
      {record.checkOutPhotoId && <SelfieThumb fileId={record.checkOutPhotoId} label="Clock-out selfie" />}
      {loc && (
        <a
          href={mapLink(loc.latitude, loc.longitude)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open clock-in location on map${loc.address ? `: ${loc.address}` : ''}`}
          title={loc.address ? `${loc.address} — open map` : 'Open location on map'}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-brand-600 hover:bg-surface-3 dark:text-brand-400"
        >
          <MapPin className="h-4 w-4" aria-hidden />
        </a>
      )}
    </span>
  );
};

const LocationLine = ({ point }: { point?: GeoPoint | null }) =>
  hasCoords(point) ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-2">
      <PlaceBadge point={point} />
      {point.address ? <span className="w-full font-medium text-fg">{point.address}</span> : null}
      <span className="inline-flex items-center gap-1 tabular-nums">
        <MapPin className="h-3.5 w-3.5 text-muted" aria-hidden />
        {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}
        {typeof point.accuracy === 'number' && <span className="text-muted">±{Math.round(point.accuracy)} m</span>}
      </span>
      <a
        href={mapLink(point.latitude, point.longitude)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline dark:text-brand-400"
      >
        Open map
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </span>
  ) : (
    <span className="text-xs text-muted">No location recorded</span>
  );

const CapturePanel = ({ title, time, photoId, point, timeZone }: { title: string; time: string | null; photoId?: string | null; point?: GeoPoint | null; timeZone: string }) => (
  <div className="flex gap-3 rounded-xl border border-line bg-surface p-3">
    {photoId ? (
      <SelfieThumb fileId={photoId} label={`${title} selfie`} size="lg" />
    ) : (
      <span className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-[11px] text-muted">
        <ImageOff className="h-4 w-4" aria-hidden />
        No selfie
      </span>
    )}
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{title}</p>
      <p className="text-base font-semibold text-fg tabular-nums">{formatTimeIn(time, timeZone)}</p>
      <LocationLine point={point} />
    </div>
  </div>
);

/** Clock-in / clock-out verification: selfie, time and location for each. */
export const CaptureDetails = ({ record, timeZone, className }: { record: AttendanceBase; timeZone: string; className?: string }) => {
  if (!record.checkIn) return null;
  return (
    <section aria-label="Clock-in verification" className={cn('grid gap-3 sm:grid-cols-2', className)}>
      <CapturePanel title="Clock in" time={record.checkIn} photoId={record.checkInPhotoId} point={record.checkInLocation} timeZone={timeZone} />
      {record.checkOut ? (
        <CapturePanel title="Clock out" time={record.checkOut} photoId={record.checkOutPhotoId} point={record.checkOutLocation} timeZone={timeZone} />
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-line p-3 text-sm text-muted">Not clocked out yet</div>
      )}
    </section>
  );
};
