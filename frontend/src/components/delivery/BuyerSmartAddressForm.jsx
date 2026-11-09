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
    <div className="w-full max-w-xl mx-auto bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xl overflow-hidden transition-all">
      {/* Header */}
      <div className="px-6 py-5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/70 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Building className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              Delivery Location (Lahore Only)
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Smart Location Lite: Select your cluster and enter your delivery address
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 text-xs rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Mismatch Warning Alert */}
        {mismatchWarning && (
          <div className="p-3 text-xs rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">{mismatchWarning.message}</p>
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                Suggested Cluster: <strong>{mismatchWarning.suggested_cluster_name}</strong>
              </p>
            </div>
          </div>
        )}

        {/* 1. City: Fixed to Lahore (Decision 5) */}
        <div>
          <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
            City <span className="text-neutral-400 font-normal">(Launch Market)</span>
          </label>
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs font-medium cursor-not-allowed">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Lahore District, Punjab</span>
            <span className="ml-auto text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Fixed Launch Market
            </span>
          </div>
        </div>

        {/* 2. Delivery Cluster: Predefined Searchable List (Decision 2) */}
        <div className="relative">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
            Delivery Cluster <span className="text-amber-600 font-bold">*</span>
          </label>

          <div
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs cursor-pointer hover:border-amber-500 transition-colors"
          >
            {selectedCluster ? (
              <div className="flex flex-col text-left">
                <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                  {selectedCluster.name}
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 line-clamp-1">
                  {selectedCluster.covered_areas_summary || selectedCluster.hub_name}
                </span>
              </div>
            ) : (
              <span className="text-neutral-400">Select your Lahore delivery cluster...</span>
            )}
            <ChevronDown className="w-4 h-4 text-neutral-400 ml-2 shrink-0" />
          </div>

          {/* Searchable Dropdown Menu */}
          {isDropdownOpen && (
            <div className="absolute z-30 w-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-2xl overflow-hidden max-h-64 flex flex-col">
              <div className="p-2 border-b border-neutral-100 dark:border-neutral-700 flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-neutral-400" />
                <input
                  type="text"
                  value={clusterSearch}
                  onChange={(e) => setClusterSearch(e.target.value)}
                  placeholder="Search cluster or town (e.g. Johar, DHA, Gulberg)..."
                  className="w-full text-xs bg-transparent border-none focus:outline-none text-neutral-900 dark:text-neutral-100"
                  autoFocus
                />
              </div>

              <div className="overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-700/50">
                {filteredClusters.length > 0 ? (
                  filteredClusters.map((cluster) => (
                    <div
                      key={cluster.id}
                      onClick={() => {
                        setSelectedClusterId(cluster.id);
                        setIsDropdownOpen(false);
                        setClusterSearch('');
                      }}
                      className={`p-3 text-xs cursor-pointer transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/20 ${
                        Number(selectedClusterId) === cluster.id ? 'bg-amber-500/10' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-neutral-900 dark:text-neutral-100">
                          {cluster.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300">
                          ID: {cluster.id}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                        {cluster.covered_areas_summary}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-xs text-neutral-400">
                    No matching clusters found.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. Society / Area: Free Text (Decision 3) */}
        <div>
          <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
            Society / Area <span className="text-amber-600 font-bold">*</span>
            <span className="text-neutral-400 font-normal ml-1">(Free Text)</span>
          </label>
          <input
            type="text"
            value={societyArea}
            onChange={(e) => setSocietyArea(e.target.value)}
            placeholder="e.g. Johar Town Block G1, DHA Phase 6 Sector B, Model Town Block H..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
          <p className="text-[11px] text-neutral-400 mt-1">
            Enter your neighborhood, housing society, phase, or commercial market.
          </p>
        </div>

        {/* 4. Complete Delivery Address: Free Text (Decision 4) */}
        <div>
          <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
            Complete Delivery Address <span className="text-amber-600 font-bold">*</span>
          </label>
          <textarea
            rows={2}
            value={fullAddress}
            onChange={(e) => setFullAddress(e.target.value)}
            placeholder="Shop / Unit #, Building name, Street #, Nearby landmark..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-none"
          />
        </div>

        {/* 5. Optional Map Pin (Decision 6) */}
        <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setIsMapExpanded(!isMapExpanded)}
            className="w-full flex items-center justify-between text-xs font-semibold text-amber-600 dark:text-amber-400 hover:text-amber-700 py-1"
          >
            <span className="flex items-center gap-1.5">
              <Compass className="w-4 h-4" />
              {isMapExpanded ? 'Hide Optional Map Pin' : 'Optional: Set Pin on Map to Improve Delivery Accuracy'}
            </span>
            <span className="text-[11px] text-neutral-400 font-normal">
              {pinPosition ? 'Pin Placed' : 'Not Set'}
            </span>
          </button>

          {isMapExpanded && (
            <div className="mt-3 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 h-48 relative">
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
              <div className="absolute bottom-2 left-2 z-[400] bg-white/90 dark:bg-neutral-900/90 backdrop-blur px-2 py-1 rounded text-[10px] text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700">
                Click anywhere on map to position pin
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
            className="rounded border-neutral-300 text-amber-600 focus:ring-amber-500"
          />
          <label htmlFor="is_default_addr" className="text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
            Set as default delivery address for future pools
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-200 dark:border-neutral-800">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-neutral-950 transition-colors shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save Delivery Address'}
          </button>
        </div>
      </form>
    </div>
  );
}
