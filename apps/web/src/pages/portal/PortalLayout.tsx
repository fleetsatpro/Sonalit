import React from 'react';
import { Outlet } from '@tanstack/react-router';

export default function PortalLayout(): React.ReactElement {
  return <Outlet />;
}
