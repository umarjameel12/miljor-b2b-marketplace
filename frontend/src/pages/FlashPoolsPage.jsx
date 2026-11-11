// Legacy entry point retained for existing deep links; buyer discovery now has
// ONE authoritative page with ALL / REGULAR / FLASH filters.
import React from 'react';
import {Navigate} from 'react-router-dom';
export const FlashPoolsPage=()=> <Navigate to="/pools?type=FLASH" replace/>;
export default FlashPoolsPage;
