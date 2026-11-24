// =============================================================================
// src/components/delivery/BuyerSmartAddressForm.jsx
// MilJor Special Phase G2: Buyer Smart Location Lite Delivery Address Form
// Conforms to Decisions 1-6: Lahore-Fixed, Predefined Cluster, Free-Text Society & Address, Optional Pin
// =============================================================================
import React, { useState, useEffect } from 'react';
import { MapPin, Navigation, ShieldCheck, AlertTriangle, Building, Home, CheckCircle2, Search, Compass, ChevronDown } from 'lucide-react';
import { geoApi } from '../../api/geo';
import { deliveryApi } from '../../api/delivery';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet pin icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Interactive map click listener for optional pin placement
function MapPinPicker({ position, onPinPlaced }) {
  useMapEvents({
    click(e) {
      onPinPlaced([e.latlng.lat, e.latlng.lng]);
    },
  });
  return position ? <Marker position={position} /> : null;
}

export default function BuyerSmartAddressForm({ onAddressSaved, onCancel, initialData = null }) {
  const [clusters, setClusters] = useState([]);
  const [selectedClusterId, setSelectedClusterId] = useState(initialData?.cluster_id || '');
  const [societyArea, setSocietyArea] = useState(initialData?.society_area || '');
  const [fullAddress, setFullAddress] = useState(initialData?.full_address || '');
  const [isDefault, setIsDefault] = useState(initialData?.is_default || false);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [pinPosition, setPinPosition] = useState(
    initialData?.pin_latitude && initialData?.pin_longitude
      ? [initialData.pin_latitude, initialData.pin_longitude]
      : null
  );

  const [clusterSearch, setClusterSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [mismatchWarning, setMismatchWarning] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Load predefined Lahore clusters from backend
  useEffect(() => {
    async function fetchClusters() {
      try {
        const res = await geoApi.getClusters();
        if (res?.success) {
          setClusters(res.data.clusters || []);
        }
      } catch (err) {
        console.error('[BuyerSmartAddressForm] Failed to load clusters:', err);
      }
    }
    fetchClusters();
  }, []);

  const selectedCluster = clusters.find(c => c.id === Number(selectedClusterId));

  const filteredClusters = clusters.filter(c => {
    if (!clusterSearch.trim()) return true;
    const term = clusterSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      c.cluster_code.toLowerCase().includes(term) ||
      (c.covered_areas_summary && c.covered_areas_summary.toLowerCase().includes(term))
    );
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setMismatchWarning(null);

    if (!selectedClusterId) {
      setErrorMessage('Please select a predefined Lahore delivery cluster.');
      return;
    }
    if (!societyArea.trim()) {
      setErrorMessage('Please enter your Society / Area (e.g. Johar Town Block G1, DHA Phase 6).');
      return;
    }
    if (!fullAddress.trim()) {
      setErrorMessage('Please enter your complete delivery address (shop/building, street, landmark).');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        city: 'Lahore',
        cluster_id: Number(selectedClusterId),
        society_area: societyArea.trim(),
        full_address: fullAddress.trim(),
        pin_latitude: pinPosition ? pinPosition[0] : null,
        pin_longitude: pinPosition ? pinPosition[1] : null,
        is_default: isDefault
      };

      const result = await deliveryApi.createBuyerAddress(payload);
      if (result.success) {
        if (result.mismatch_warning) {
          setMismatchWarning(result.mismatch_warning);
        }
        if (onAddressSaved) {
          onAddressSaved(result.data, result.mismatch_warning);
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Failed to save delivery address.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="w-full max-w-xl mx-auto rounded-2xl border shadow-sm overflow-hidden transition-all"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        borderColor: 'var(--border-default)',
      }}
    >
      {/* Header */}
      <div
        className="px-5 py-4 border-b flex items-center justify-between"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <Building className="w-4 h-4 text-emerald-800 dark:text-champagne" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Add Delivery Address
            </h3>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Lahore cluster & drop-off details
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Mismatch Warning Alert */}
        {mismatchWarning && (
          <div className="p-3 text-xs rounded-xl border flex items-start gap-2 bg-[#fbf5e8] dark:bg-[#2b2212] border-[#e2cb9c] dark:border-[#59441f] text-[#7a5418] dark:text-[#e6c785]">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{mismatchWarning.message}</p>
              <p className="mt-1 text-[11px]">
                Suggested Cluster: <strong>{mismatchWarning.suggested_cluster_name}</strong>
              </p>
            </div>
          </div>
        )}

        {/* 1. City: Fixed to Lahore */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            City
          </label>
          <div
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-medium cursor-not-allowed"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span>Lahore, Punjab</span>
          </div>
        </div>

        {/* 2. Delivery Cluster: Predefined Searchable List */}
        <div className="relative">
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Delivery Cluster <span style={{ color: 'var(--brand-accent)' }}>*</span>
          </label>

          <div
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs cursor-pointer transition-colors hover:border-[var(--brand-accent)]"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            {selectedCluster ? (
              <div className="flex flex-col text-left">
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {selectedCluster.name}
                </span>
                <span className="text-[11px] line-clamp-1" style={{ color: 'var(--text-muted)' }}>
                  {selectedCluster.covered_areas_summary || selectedCluster.hub_name}
                </span>
              </div>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>Select Lahore cluster...</span>
            )}
            <ChevronDown className="w-4 h-4 ml-2 shrink-0" style={{ color: 'var(--text-muted)' }} />
          </div>

          {/* Searchable Dropdown Menu */}
          {isDropdownOpen && (
            <div
              className="absolute z-30 w-full mt-1 border rounded-xl shadow-2xl overflow-hidden max-h-60 flex flex-col"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
              }}
            >
              <div
                className="p-2 border-b flex items-center gap-2"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={clusterSearch}
                  onChange={(e) => setClusterSearch(e.target.value)}
                  placeholder="Search cluster or area (e.g. Johar, DHA, Gulberg)..."
                  className="w-full text-xs bg-transparent border-none focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  autoFocus
                />
              </div>

              <div className="overflow-y-auto divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {filteredClusters.length > 0 ? (
                  filteredClusters.map((cluster) => (
                    <div
                      key={cluster.id}
                      onClick={() => {
                        setSelectedClusterId(cluster.id);
                        setIsDropdownOpen(false);
                        setClusterSearch('');
                      }}
                      className="p-3 text-xs cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      style={{
                        backgroundColor: Number(selectedClusterId) === cluster.id ? 'var(--bg-sidebar-active)' : 'transparent',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {cluster.name}
                        </span>
                      </div>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {cluster.covered_areas_summary}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    No matching clusters found.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. Society / Area */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Society / Area <span style={{ color: 'var(--brand-accent)' }}>*</span>
          </label>
          <input
            type="text"
            value={societyArea}
            onChange={(e) => setSocietyArea(e.target.value)}
            placeholder="e.g. Johar Town Block G1, DHA Phase 6"
            className="w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:border-[var(--brand-accent)]"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* 4. Complete Delivery Address */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Street / Building Address <span style={{ color: 'var(--brand-accent)' }}>*</span>
          </label>
          <textarea
            rows={2}
            value={fullAddress}
            onChange={(e) => setFullAddress(e.target.value)}
            placeholder="Shop / Unit #, Building, Street, Landmark..."
            className="w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:border-[var(--brand-accent)] resize-none"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* 5. Optional Map Pin */}
        <div className="pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => setIsMapExpanded(!isMapExpanded)}
            className="w-full flex items-center justify-between text-xs font-semibold py-1 cursor-pointer transition-opacity hover:opacity-80"
            style={{ color: 'var(--brand-accent)' }}
          >
            <span className="flex items-center gap-1.5">
              <Compass className="w-4 h-4" />
              {isMapExpanded ? 'Hide Map Pin' : 'Pin location on map (optional)'}
            </span>
            <span className="text-[11px] font-normal" style={{ color: 'var(--text-muted)' }}>
              {pinPosition ? 'Pin Placed' : 'Not Set'}
            </span>
          </button>

          {isMapExpanded && (
            <div className="mt-3 rounded-xl overflow-hidden border h-48 relative" style={{ borderColor: 'var(--border-default)' }}>
              <MapContainer
                center={pinPosition || [31.5204, 74.3587]}
                zoom={12}
                scrollWheelZoom={false}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapPinPicker position={pinPosition} onPinPlaced={(pos) => setPinPosition(pos)} />
              </MapContainer>
              <div
                className="absolute bottom-2 left-2 z-[400] backdrop-blur px-2 py-1 rounded text-[10px] border"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-secondary)',
                }}
              >
                Click map to set pin
              </div>
            </div>
          )}
        </div>

        {/* Default Checkbox */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_default_addr"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="rounded cursor-pointer"
          />
          <label htmlFor="is_default_addr" className="text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            Set as default delivery address
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-xs font-semibold border transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="landing-gradient-cta px-5 py-2 rounded-xl text-xs font-bold shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? 'Saving...' : 'Save Address'}
          </button>
        </div>
      </form>
    </div>
  );
}
