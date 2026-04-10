const express = require("express");

const { apiLimiter } = require("../middlewares/rateLimit");
const { auth } = require("../middlewares/auth");
const { subscriptionGuard } = require("../middlewares/subscriptionGuard");

const { healthRoutes } = require("../features/health/routes");
const { authRoutes } = require("../features/auth/routes");
const { vendorRoutes } = require("../features/vendors/routes");

const { clientRoutes } = require("../features/clients/routes");
const { routesFeatureRoutes } = require("../features/routesFeature/routes");
const { creditRoutes } = require("../features/credits/routes");
const { cashRoutes } = require("../features/cash/routes");
const { locationRoutes } = require("../features/locations/routes");
const { reportRoutes } = require("../features/reports/routes");
const { statsRoutes } = require("../features/stats/routes");

const apiRouter = express.Router();

// Public
apiRouter.use(healthRoutes);
apiRouter.use("/auth", authRoutes);

// Protected: rateLimit -> auth -> subscriptionGuard
const protectedRouter = express.Router();
protectedRouter.use(apiLimiter);
protectedRouter.use(auth);
protectedRouter.use(subscriptionGuard);

// (por ahora vendors tiene _ping; lo demás son stubs)
protectedRouter.use(vendorRoutes);
protectedRouter.use(clientRoutes);
protectedRouter.use(routesFeatureRoutes);
protectedRouter.use(creditRoutes);
protectedRouter.use(cashRoutes);
protectedRouter.use(locationRoutes);
protectedRouter.use(reportRoutes);
protectedRouter.use(statsRoutes);

apiRouter.use(protectedRouter);

module.exports = { apiRouter };
