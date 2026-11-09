// =============================================================================
// src/components/geo/LahoreClusterMap.jsx
// MilJor Special Phase G1: Lahore-Only Interactive Cluster & Delivery Zone Map
// Leaflet + OpenStreetMap + Zero Google Maps Dependencies
// =============================================================================
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polygon, Circle, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, ShieldCheck, AlertCircle, Compass, Search, Layers, CheckCircle2 } from 'lucide-react';
import { geoApi } from '../../api/geo';

// Fix Leaflet's default icon missing issues in bundlers like Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom SVG Hub Icon Builder
function createHubIcon(color = '#F59E0B', label = '') {
  return L.divIcon({
    className: 'custom-hub-marker',
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center;">
        <div style="
          width: 32px; 
          height: 32px; 
          border-radius: 50%; 
          background: ${color}; 
          box-shadow: 0 0 14px ${color}88, 0 4px 8px rgba(0,0,0,0.3); 
          border: 2px solid #FFFFFF; 
          display: flex; 
          align-items: center; 
          justify-content: center;
          color: #FFFFFF;
          font-weight: 700;
          font-size: 11px;
        ">
          ${label || '★'}
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18]
  });
}

// Child component to programmatically pan/zoom map
function MapController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.flyTo(center, zoom || 12, { duration: 1.2 });
    }
  }, [center, zoom, map]);
  return null;
}

export default function LahoreClusterMap({ 
  onLocalitySelect, 
  initialClusterId = null,
  height = '520px',
  compact = false 
}) {
  const [clusters, setClusters] = useState([]);
  const [boundary, setBoundary] = useState(null);
  const [selectedClusterId, setSelectedClusterId] = useState(initialClusterId);
  const [searchQuery, setSearchQuery] = useState('');
  const [verificationResult, setVerificationResult] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [mapCenter, setMapCenter] = useState([31.5204, 74.3587]); // Central Lahore (Gulberg/Mall)
  const [mapZoom, setMapZoom] = useState(11);
  const [isLoading, setIsLoading] = useState(true);

  // Load clusters and authoritative Lahore boundary on mount
  useEffect(() => {
    let isMounted = true;
    async function loadGeoData() {
      try {
        const [clustersRes, boundaryRes] = await Promise.all([
          geoApi.getClusters(),
          geoApi.getBoundary()
        ]);

        if (isMounted) {
          if (clustersRes?.success) {
            setClusters(clustersRes.data.clusters || []);
          }
          if (boundaryRes?.success) {
            setBoundary(boundaryRes.data);
          }
        }
      } catch (err) {
        console.error('[LahoreClusterMap] Failed to load geo datasets:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadGeoData();
    return () => { isMounted = false; };
  }, []);

  // Format GeoJSON coordinates [lng, lat] into Leaflet [lat, lng]
  const districtPolygonLatLngs = useMemo(() => {
    if (!boundary?.geojson?.geometry?.coordinates?.[0]) return [];
    return boundary.geojson.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
  }, [boundary]);

  // Handle address check / resolution
  const handleVerifyAddress = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsVerifying(true);
    setVerificationResult(null);

    try {
      const res = await geoApi.resolveAddress(searchQuery.trim());
      if (res?.success) {
        setVerificationResult(res.data);
        if (res.data.status === 'IN_LAHORE_SUPPORTED' && res.data.locality) {
          const lat = res.data.locality.latitude;
          const lng = res.data.locality.longitude;
          setMapCenter([lat, lng]);
          setMapZoom(13);
          if (onLocalitySelect) {
            onLocalitySelect(res.data.locality);
          }
        }
      }
    } catch (err) {
      console.error('[LahoreClusterMap] Verification failed:', err);
      setVerificationResult({
        status: 'ERROR',
        message: 'Network verification failed. Please try again.'
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClusterSelect = (cluster) => {
    if (!cluster) {
      setSelectedClusterId(null);
      setMapCenter([31.5204, 74.3587]);
      setMapZoom(11);
      return;
    }
    setSelectedClusterId(cluster.id);
    setMapCenter([cluster.hub_latitude, cluster.hub_longitude]);
    setMapZoom(12);
  };

  const filteredClusters = useMemo(() => {
    if (!selectedClusterId) return clusters;
    return clusters.filter(c => c.id === selectedClusterId);
  }, [clusters, selectedClusterId]);

  return (
    <div className="w-full rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl transition-all">
      {/* Header Bar */}
      <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Compass className="w-5 h-5 animate-spin-slow" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                Lahore District Cluster Network
              </h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <ShieldCheck className="w-3 h-3 mr-1" /> District-Verified
              </span>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              OpenStreetMap + OSRM logistics coverage strictly confined to Lahore District (Raiwind to Shahdara)
            </p>
          </div>
        </div>

        {/* Address Verification Bar */}
        <form onSubmit={handleVerifyAddress} className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Test locality (e.g. Gulberg, Johar Town, Kasur)..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
          </div>
          <button
            type="submit"
            disabled={isVerifying || !searchQuery.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-xl bg-amber-500 hover:bg-amber-600 text-neutral-950 disabled:opacity-50 transition-colors shadow-sm"
          >
            {isVerifying ? 'Checking...' : 'Verify Area'}
          </button>
        </form>
      </div>

      {/* Verification Result Banner */}
      {verificationResult && (
        <div className={`px-5 py-3 text-xs border-b flex items-center justify-between gap-3 ${
          verificationResult.status === 'IN_LAHORE_SUPPORTED'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
            : verificationResult.status === 'OUTSIDE_LAHORE'
            ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20'
            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20'
        }`}>
          <div className="flex items-center gap-2">
            {verificationResult.status === 'IN_LAHORE_SUPPORTED' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <div>
              <span className="font-semibold uppercase tracking-wider text-[10px] mr-2 px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10">
                {verificationResult.status}
              </span>
              <span>{verificationResult.message || `${verificationResult.locality?.name_en} verified inside ${verificationResult.cluster?.name}`}</span>
            </div>
          </div>
          <button 
            onClick={() => setVerificationResult(null)}
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 text-sm font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* Cluster Filter Chips */}
      {!compact && (
        <div className="px-5 py-2.5 border-b border-neutral-100 dark:border-neutral-800/80 bg-neutral-50/50 dark:bg-neutral-900/50 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mr-2 flex items-center gap-1 shrink-0">
            <Layers className="w-3.5 h-3.5" /> Clusters:
          </span>
          <button
            onClick={() => handleClusterSelect(null)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
              selectedClusterId === null
                ? 'bg-amber-500 text-neutral-950 font-semibold shadow-sm'
                : 'bg-neutral-200/60 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
            }`}
          >
            All Clusters ({clusters.length})
          </button>
          {clusters.map((cluster) => {
            const isSelected = selectedClusterId === cluster.id;
            return (
              <button
                key={cluster.id}
                onClick={() => handleClusterSelect(cluster)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-amber-500 text-neutral-950 font-semibold shadow-sm'
                    : 'bg-neutral-200/60 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                {cluster.region_code}: {cluster.name.split('/')[0].trim()}
              </button>
            );
          })}
        </div>
      )}

      {/* Interactive Leaflet Map Container */}
      <div style={{ height, width: '100%', position: 'relative' }}>
        {isLoading ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400">
            <Compass className="w-8 h-8 animate-spin text-amber-500 mb-2" />
            <p className="text-xs">Loading Lahore geographic layers...</p>
          </div>
        ) : (
          <MapContainer
            center={mapCenter}
            zoom={mapZoom}
            scrollWheelZoom={true}
            style={{ height: '100%', width: '100%', zIndex: 10 }}
          >
            <MapController center={mapCenter} zoom={mapZoom} />

            {/* OpenStreetMap Tile Layer (Compliant with OSM usage policies) */}
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={18}
            />

            {/* Authoritative Lahore District Boundary Polygon */}
            {districtPolygonLatLngs.length > 0 && (
              <Polygon
                positions={districtPolygonLatLngs}
                pathOptions={{
                  color: '#D97706',
                  weight: 3,
                  opacity: 0.85,
                  dashArray: '6, 6',
                  fillColor: '#F59E0B',
                  fillOpacity: 0.05
                }}
              >
                <Popup>
                  <div className="text-xs p-1">
                    <strong className="text-amber-600 block">Lahore District Boundary</strong>
                    <span className="text-neutral-600">Official administrative territory. Bounded by Ravi River to the north/west and Kasur District to the south.</span>
                  </div>
                </Popup>
              </Polygon>
            )}

            {/* Operational Delivery Clusters */}
            {filteredClusters.map((cluster) => {
              const center = [cluster.hub_latitude, cluster.hub_longitude];
              const radiusMeters = (cluster.coverage_radius_km || 5.0) * 1000;
              const isSelected = selectedClusterId === cluster.id;

              return (
                <React.Fragment key={cluster.id}>
                  {/* Coverage Area Circle */}
                  <Circle
                    center={center}
                    radius={radiusMeters}
                    pathOptions={{
                      color: isSelected ? '#10B981' : '#F59E0B',
                      weight: isSelected ? 2.5 : 1.5,
                      fillColor: isSelected ? '#10B981' : '#F59E0B',
                      fillOpacity: isSelected ? 0.18 : 0.09
                    }}
                  />

                  {/* Hub Marker */}
                  <Marker
                    position={center}
                    icon={createHubIcon(isSelected ? '#10B981' : '#D97706', cluster.region_code)}
                  >
                    <Popup>
                      <div className="p-1 min-w-[200px] text-xs">
                        <div className="flex items-center justify-between border-b pb-1 mb-1">
                          <strong className="text-neutral-900 font-bold">{cluster.name}</strong>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono font-bold">
                            {cluster.cluster_code}
                          </span>
                        </div>
                        <div className="space-y-1 text-neutral-600">
                          <div><strong>Hub Center:</strong> {cluster.hub_name}</div>
                          <div><strong>Region Code:</strong> Region {cluster.region_code}</div>
                          <div><strong>Coverage Radius:</strong> {cluster.coverage_radius_km} km</div>
                          {cluster.metadata?.natural_barriers && (
                            <div className="text-[11px] text-amber-700 bg-amber-50 p-1 rounded mt-1">
                              <strong>Barriers:</strong> {cluster.metadata.natural_barriers.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                </React.Fragment>
              );
            })}
          </MapContainer>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-5 py-2.5 bg-neutral-50 dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 text-[11px] text-neutral-500 dark:text-neutral-400 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
            Operational Cluster Hub
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full border border-dashed border-amber-600 inline-block"></span>
            District Boundary
          </span>
        </div>
        <div className="text-[10px] text-neutral-400">
          Zero Google Maps API calls • Powered by Leaflet & OpenStreetMap
        </div>
      </div>
    </div>
  );
}
