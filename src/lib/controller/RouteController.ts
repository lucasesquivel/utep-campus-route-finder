import { 
  RouteSelection, 
  RouteResponse, 
  ValidationResult, 
  ValidationCode, 
  RouteFailure, 
  NoRouteReason 
} from './types';

// Import interfaces/classes from Campus Data and Routing subsystems
// (Adjust relative paths according to your repository structure)
import { CampusRepository } from '$lib/campusdata/CampusRepository';
import { RouteEngine } from '$lib/routing/RouteEngine';
import { ShortestRouteStrategy } from '$lib/routing/ShortestRouteStrategy';
import { EasyRouteStrategy } from '$lib/routing/EasyRouteStrategy';
import { AdaRouteStrategy } from '$lib/routing/AdaRouteStrategy';
import { RouteRequest, RouteResult } from '$lib/routing/types';

export class RouteController {
  private repository: CampusRepository;
  private routeEngine?: RouteEngine;
  private readonly MAX_MAP_SNAP_DISTANCE_M = 50;

  constructor(repository: CampusRepository) {
    this.repository = repository;
  }

  /**
   * Contract AC-1: Process Route Request
   * Takes user selections, validates them, builds endpoints, and obtains a Route or failure.
   */
  public async processRouteRequest(selection: RouteSelection): Promise<RouteResponse> {
    try {
      // 1. Ensure campus data is loaded
      if (this.repository.state !== 'ready') {
        try {
          await this.repository.loadCampusData();
        } catch (err) {
          return this.handleRouteFailure({ name: 'CampusDataLoadError', message: 'Failed to load campus data' });
        }
      }

      // 2. Initialize RouteEngine once data is ready
      if (!this.routeEngine) {
        const graph = this.repository.getCampusGraph();
        // Register strategies available for Increment 1 & 2
        const strategies = [
          new ShortestRouteStrategy(),
          new EasyRouteStrategy(),
          new AdaRouteStrategy()
        ];
        this.routeEngine = new RouteEngine(graph, strategies);
      }

      // 3. Validate selections (Contract AC-2)
      const validation = this.validateRouteRequest(selection);
      if (!validation.valid) {
        return this.handleRouteFailure({ 
          name: 'ValidationFailure', 
          code: validation.code, 
          message: validation.message 
        });
      }

      // 4. Build Routing Endpoints
      const graph = this.repository.getCampusGraph();
      
      const buildEndpoints = (locationSelection: typeof selection.origin) => {
        if (locationSelection.kind === 'building') {
          const entrances = this.repository.getBuildingEntrances(locationSelection.buildingId);
          return entrances.map(e => ({ nodeId: e.nodeId, entrance: e }));
        } else {
          const nearestNode = graph.findNearestNode(locationSelection.location, this.MAX_MAP_SNAP_DISTANCE_M);
          return [{ nodeId: nearestNode!.id }];
        }
      };

      const origins = buildEndpoints(selection.origin);
      const destinations = buildEndpoints(selection.destination);

      const routeRequest: RouteRequest = {
        mode: selection.mode,
        origins,
        destinations
      };

      // 5. Retrieve Route Result (Contract AC-3)
      return this.retrieveRouteResult(routeRequest);

    } catch (error) {
      console.error('Unexpected error in processRouteRequest:', error);
      return this.handleRouteFailure(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Contract AC-2: Validate Route Request
   */
  public validateRouteRequest(selection: RouteSelection): ValidationResult {
    if (!selection.origin) {
      return { valid: false, code: 'MISSING_ORIGIN', message: 'Starting location is required.' };
    }
    if (!selection.destination) {
      return { valid: false, code: 'MISSING_DESTINATION', message: 'Destination location is required.' };
    }

    // Check supported modes via RouteEngine if initialized, or fallback array
    const supportedModes = this.routeEngine ? this.routeEngine.supportedModes() : ['shortest', 'easy', 'ada'];
    if (!supportedModes.includes(selection.mode)) {
      return { valid: false, code: 'UNSUPPORTED_MODE', message: `Routing mode '${selection.mode}' is not supported.` };
    }

    const graph = this.repository.getCampusGraph();

    // Validate origin
    if (selection.origin.kind === 'building') {
      const building = this.repository.getBuilding(selection.origin.buildingId);
      if (!building) {
        return { valid: false, code: 'UNKNOWN_BUILDING', message: 'Starting building does not exist.' };
      }
      const entrances = this.repository.getBuildingEntrances(selection.origin.buildingId);
      if (entrances.length === 0) {
        return { valid: false, code: 'NO_ENTRANCES', message: 'Starting building has no registered entrances.' };
      }
    } else {
      const nearest = graph.findNearestNode(selection.origin.location, this.MAX_MAP_SNAP_DISTANCE_M);
      if (!nearest) {
        return { valid: false, code: 'LOCATION_OFF_NETWORK', message: 'Starting location is too far from a pedestrian path.' };
      }
    }

    // Validate destination
    if (selection.destination.kind === 'building') {
      const building = this.repository.getBuilding(selection.destination.buildingId);
      if (!building) {
        return { valid: false, code: 'UNKNOWN_BUILDING', message: 'Destination building does not exist.' };
      }
      const entrances = this.repository.getBuildingEntrances(selection.destination.buildingId);
      if (entrances.length === 0) {
        return { valid: false, code: 'NO_ENTRANCES', message: 'Destination building has no registered entrances.' };
      }
    } else {
      const nearest = graph.findNearestNode(selection.destination.location, this.MAX_MAP_SNAP_DISTANCE_M);
      if (!nearest) {
        return { valid: false, code: 'LOCATION_OFF_NETWORK', message: 'Destination location is too far from a pedestrian path.' };
      }
    }

    return { valid: true };
  }

  /**
   * Contract AC-3: Retrieve Route Result
   */
  public retrieveRouteResult(request: RouteRequest): RouteResponse {
    if (!this.routeEngine) {
      return this.handleRouteFailure({ name: 'StateError', message: 'RouteEngine not initialized' });
    }

    const result: RouteResult = this.routeEngine.calculateRoute(request);

    if (result.status === 'found') {
      return { status: 'success', route: result.route };
    } else {
      return this.handleRouteFailure(result);
    }
  }

  /**
   * Contract AC-4: Handle Route Failure
   */
  public handleRouteFailure(cause: any): RouteResponse {
    // Handle NoRouteResult from Routing
    if (cause && cause.status === 'no-route') {
      const reason: NoRouteReason = cause.reason;
      let message = 'No route could be calculated.';
      if (reason === 'NO_USABLE_ORIGIN') {
        message = 'The starting building has no entrance usable in this mode.';
      } else if (reason === 'NO_USABLE_DESTINATION') {
        message = 'The destination building has no entrance usable in this mode.';
      } else if (reason === 'UNREACHABLE') {
        message = 'No route exists between these locations for the selected mode.';
      }
      return {
        status: 'failure',
        failure: {
          code: 'NO_ROUTE',
          message,
          noRouteReason: reason
        }
      };
    }

    // Handle Validation Failures
    if (cause && cause.name === 'ValidationFailure') {
      return {
        status: 'failure',
        failure: {
          code: 'INVALID_REQUEST',
          message: cause.message,
          validationCode: cause.code
        }
      };
    }

    // Handle Data Loading Errors
    if (cause && (cause.name === 'CampusDataLoadError' || cause.message?.includes('load'))) {
      return {
        status: 'failure',
        failure: {
          code: 'DATA_NOT_READY',
          message: 'Campus data could not be loaded. Please try again.'
        }
      };
    }

    // Default Unexpected Error
    return {
      status: 'failure',
      failure: {
        code: 'UNEXPECTED_ERROR',
        message: 'Something went wrong. Please try again.'
      }
    };
  }
}