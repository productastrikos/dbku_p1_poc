import React, { useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, Polyline, Popup, Tooltip } from 'react-leaflet';
import { resolveColor } from '../charts/chartTheme';
import { useTheme } from '../../theme/ThemeProvider';
import { ASSET_TYPES, ASSET_STATUS, ZONE_TONE } from '../../data/reference';

const pulseIcon = L.divIcon({ className: '', html: '<div class="pulse-marker"><span class="ring"></span><span class="core"></span></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const stopIcon = (n) => L.divIcon({ className: '', html: `<div class="route-stop">${n}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] });

function boundsFor(zones, assets) {
  const pts = assets.length ? assets.map((a) => [a.lat, a.lng]) : zones.map((z) => z.center);
  return L.latLngBounds(pts).pad(0.12);
}

/**
 * Leaflet map of DBKU assets, colour-coded by status.
 *   assets       with .status (alert | watch | offline | normal)
 *   zones        hotspot zones; zoneBands { [zoneId]: 'High'|'Medium'|'Low' } tints them
 *   cameras, dealers, route ({ stops, base }) are optional layers
 *   heat         draws soft risk halos instead of zone outlines
 */
export default function AssetMap({
  assets, zones, zoneBands, cameras, dealers, route, height = 480, onSelectAsset, heat = false,
  legend = true, focus, className = '', children,
}) {
  const { theme } = useTheme();
  const bounds = useMemo(() => boundsFor(zones, focus ? assets.filter((a) => a.zone === focus) : assets), [zones, assets, focus]);
  const tone = (status) => resolveColor(ASSET_STATUS[status]?.tone || 'success');
  const zoneColor = (z) => resolveColor(zoneBands?.[z.id] ? ZONE_TONE[zoneBands[z.id]] : 'primary');

  return (
    <div className={`card overflow-hidden relative ${className}`} style={{ height }}>
      <MapContainer key={`${focus || 'all'}`} bounds={bounds} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {zones.map((z) => (heat ? (
          [2.2, 1.6, 1.1].map((k, i) => (
            <Circle key={`h-${z.id}-${i}-${theme}-${zoneBands?.[z.id]}`} center={z.center} radius={z.radiusM * k * 0.75}
              pathOptions={{ stroke: false, fillColor: zoneColor(z), fillOpacity: 0.12 + i * 0.06 }} />
          ))
        ) : (
          <Circle key={`z-${z.id}-${theme}-${zoneBands?.[z.id]}`} center={z.center} radius={z.radiusM}
            pathOptions={{ color: zoneColor(z), weight: 1.5, dashArray: '6 6', fillColor: zoneColor(z), fillOpacity: 0.06 }}>
            <Tooltip direction="top" sticky>{z.name}{zoneBands?.[z.id] ? ` · ${zoneBands[z.id]} risk` : ''}</Tooltip>
          </Circle>
        )))}

        {assets.filter((a) => a.type === 'cable').map((a) => (
          <Polyline key={`p-${a.id}-${a.status}-${theme}`} positions={a.path}
            pathOptions={{ color: tone(a.status), weight: 4, opacity: 0.75, dashArray: a.status === 'offline' ? '4 6' : undefined }}
            eventHandlers={{ click: () => onSelectAsset?.(a) }} />
        ))}

        {route?.stops?.length > 0 && (
          <>
            <Polyline key={`route-${theme}`} positions={[[route.base.lat, route.base.lng], ...route.stops.map((s) => [s.asset.lat, s.asset.lng])]}
              pathOptions={{ color: resolveColor('primary'), weight: 3, opacity: 0.85, dashArray: '8 6' }} />
            <CircleMarker center={[route.base.lat, route.base.lng]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: resolveColor('primary'), fillOpacity: 1 }}>
              <Tooltip direction="top">{route.base.name}</Tooltip>
            </CircleMarker>
            {route.stops.map((s, i) => (
              <Marker key={`stop-${s.asset.id}`} position={[s.asset.lat, s.asset.lng]} icon={stopIcon(i + 1)} zIndexOffset={800}>
                <Tooltip direction="top">{i + 1}. {s.asset.id} · ETA {s.eta}</Tooltip>
              </Marker>
            ))}
          </>
        )}

        {dealers?.map((d) => (
          <CircleMarker key={`d-${d.id}-${theme}`} center={[d.lat, d.lng]} radius={6}
            pathOptions={{ color: '#fff', weight: 1.5, fillColor: resolveColor('accent'), fillOpacity: 0.95 }}>
            <Popup><strong>{d.name}</strong><br />Licence {d.licenceNo}<br />{d.area}</Popup>
          </CircleMarker>
        ))}

        {cameras?.map((c) => (
          <CircleMarker key={`c-${c.id}-${theme}`} center={[c.lat, c.lng]} radius={3.5}
            pathOptions={{ color: resolveColor('info'), weight: 2, fillColor: '#fff', fillOpacity: 1 }}>
            <Tooltip direction="top">{c.id} · {c.model}</Tooltip>
          </CircleMarker>
        ))}

        {assets.map((a) => {
          const popup = (
            <Popup>
              <strong>{a.id}</strong> · {ASSET_TYPES[a.type].label} <span style={{ opacity: 0.7 }}>({ASSET_TYPES[a.type].labelMs})</span><br />
              {a.name}, {a.road}<br />
              Status: <strong style={{ color: tone(a.status) }}>{ASSET_STATUS[a.status].label}</strong>
              {a.lighting === 'out' && <> · light dark</>}
              {a.openAlerts?.map((x) => <div key={x.id}>⚠ {x.title}</div>)}
            </Popup>
          );
          if (a.status === 'alert') {
            return (
              <Marker key={`a-${a.id}`} position={[a.lat, a.lng]} icon={pulseIcon} zIndexOffset={1000} eventHandlers={{ click: () => onSelectAsset?.(a) }}>
                {popup}
              </Marker>
            );
          }
          return (
            <CircleMarker key={`a-${a.id}-${a.status}-${theme}`} center={[a.lat, a.lng]} radius={a.type === 'switchboard' ? 8 : a.type === 'streetlight' ? 5 : 6.5}
              pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: tone(a.status), fillOpacity: 1 }}
              eventHandlers={{ click: () => onSelectAsset?.(a) }}>
              {popup}
            </CircleMarker>
          );
        })}
        {children}
      </MapContainer>

      {legend && (
        <div className="map-legend">
          {Object.entries(ASSET_STATUS).map(([k, s]) => (
            <span key={k}><span className="legend-dot" style={{ background: `var(--color-${s.tone})` }} />{s.label}</span>
          ))}
          {cameras && <span><span className="legend-dot" style={{ background: '#fff', borderColor: 'var(--color-info)' }} />CCTV</span>}
          {dealers && <span><span className="legend-dot" style={{ background: 'var(--color-accent)' }} />Scrap dealer</span>}
        </div>
      )}
    </div>
  );
}
