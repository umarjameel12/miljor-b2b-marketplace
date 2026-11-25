// Legacy entry point retained for existing deep links; buyer discovery now has
// ONE authoritative supplier pool marketplace.
import React from 'react';
import {Navigate} from 'react-router-dom';
export const FlashPoolsPage=()=> <Navigate to="/pools" replace/>;
export default FlashPoolsPage;
