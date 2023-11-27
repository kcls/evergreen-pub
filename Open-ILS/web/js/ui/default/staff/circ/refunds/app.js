angular.module('egRefundApp', 
    ['ngRoute', 'ui.bootstrap', 'egCoreMod', 'egUiMod', 'egGridMod'])

.config(function($routeProvider, $locationProvider, $compileProvider) {
    $locationProvider.html5Mode(true);
    $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|blob):/); // grid export

    var resolver = {delay : 
        ['egStartup', function(egStartup) {return egStartup.go()}]}

    $routeProvider.when('/circ/refunds/list', {
        templateUrl: './circ/refunds/t_list',
        controller: 'RefundListCtrl',
        resolve : resolver
    });

    $routeProvider.when('/circ/refunds/view/:id', {
        templateUrl: './circ/refunds/t_detail',
        controller: 'RefundDetailCtrl',
        resolve : resolver
    });

    $routeProvider.otherwise({redirectTo : '/circ/refunds/list'});
})

.factory('mrxSvc',
       ['$q','egCore',
function($q , egCore) {

    var service = {

        // store filters in the service so they persist across
        // list and details pages.
        filters : {
            limit_to_refundable : true,
            limit_to_1year : true
        }, 

        // sort payments newest to oldest and also set the 
        // newest as the _last_payment attribute on the mrxs.
        sort_payments : function(mrxs) {
            var payments = mrxs.refundable_payments().sort(
                function(a, b) {
                    return a.payment_time() > b.payment_time() ? -1 : 1
                }
            );
            mrxs.refundable_payments(payments);
            mrxs._last_payment = payments[0];
        }
    };

    return service;
}])


/**
 */
.controller('RefundListCtrl',
       ['$scope','$q','$window','$location','egCore','egGridDataProvider','mrxSvc',
function($scope , $q , $window , $location , egCore , egGridDataProvider , mrxSvc) {

    $scope.ctx = {
        limit_to_refundable : mrxSvc.filters.limit_to_refundable,
        limit_to_1year : mrxSvc.filters.limit_to_1year
    };

    $scope.gridControls = {
        activateItem : function(item) {
            // dbl-click goes to transaction detail view
            $location.path('/circ/refunds/view/' + item.id());
        }
    };

    var provider 
        = $scope.gridDataProvider
        = egGridDataProvider.instance({});

    $scope.ctx.perform_search = function() {
        // copy UI filters back into service
        mrxSvc.filters.limit_to_refundable = $scope.ctx.limit_to_refundable;
        mrxSvc.filters.limit_to_1year = $scope.ctx.limit_to_1year;

        provider.refresh();
    }

    function compile_query() {
        var query = {};

        if ($scope.ctx.limit_to_1year) {
            var last_year = new Date();
            last_year.setFullYear(last_year.getFullYear() - 1);
            query['-or'] = [
                {xact_finish : {'>=' : last_year.toISOString()}},
                {xact_finish : null}
            ]
        }

        if ($scope.ctx.limit_to_refundable) {
            query.action_date = null;
        }

        if (!($scope.ctx.search_param && $scope.ctx.search_query)) {
            query.id = {'<>' : null};

        } else if ($scope.ctx.search_param == 'usr_name') {

            var parts = $scope.ctx.search_query.split(/,/);
            query.usr_family_name = {'~*' : parts[0].trim()};
            if (parts[1]) query.usr_first_name = {'~*' : parts[1].trim()};
           
        } else if ($scope.ctx.search_param == 'receipt_code') {
            return receipt_code_query();

        } else {
            query[$scope.ctx.search_param] = $scope.ctx.search_query;
        }

        return $q.when(query);
    }

    function receipt_code_query() {
        // Querying the receipt code means query payments instead 
        // of transactions.

        return egCore.pcrud.search('mrps', 
            {receipt_code : $scope.ctx.search_query}
        ).then(function(payment) {
            if (payment) return {id : payment.refundable_xact()};

            // if no payments found, return a no-op query.
            return {id : null};
        });
    }

    function compile_sort() {
        // turn the grid sort data into a pcrud sort string.
        var order_by = '';
        angular.forEach(provider.sort, function(col) {
            if (order_by) order_by += ',';
            if (angular.isObject(col)) {
                var name = Object.keys(col)[0];
                order_by += name + ' ' + col[name];
            } else {
                order_by += col;
            }
        });

        return order_by ? {mrxs : order_by} : {};
    }

    provider.get = function(offset, count) {

        var deferred = $q.defer();

        compile_query().then(function(query) {

            return egCore.pcrud.search('mrxs', query,
                {   limit : count, 
                    offset : offset,
                    flesh : 1,
                    flesh_fields : {mrxs : ['refundable_payments']},
                    order_by : compile_sort()
                }
            ).then(
                deferred.resolve,
                deferred.reject,
                function(mrxs) {
                    mrxSvc.sort_payments(mrxs);
                    deferred.notify(mrxs);
                }
            );
        });

        return deferred.promise;
    }

}])

.controller('RefundDetailCtrl',
       ['$scope','$q','$routeParams','$window','$location','egCore','mrxSvc',
function($scope , $q , $routeParams , $window , $location , egCore , mrxSvc) {

    // TODO: make this call authoritative once we're running on 
    // newer pcrud.js code that supports it.  (IIRC 2.12 or later)

    function load_data() {
        egCore.pcrud.retrieve('mrxs', $routeParams.id, {
            flesh : 4, 
            flesh_fields : {
                mrxs : ['refundable_payments', 'xact'],
                mbt : ['payments', 'billings'],
                mb : ['btype']
            },
        }).then(function(mrxs) {
            if (!mrxs) return;
            if (!mrxs.refund_amount()) mrxs.refund_amount('0.00');

            if (mrxs.action_date()) {
                $scope.editing = false;
                if (mrxs.rejected() == 't') {
                    $scope.xact_state = 'rejected';
                } else {
                    $scope.xact_state = 'refunded';
                }
            } else {
                $scope.editing = true;
                $scope.xact_state = 'pending';
            }

            mrxs.xact().billings(
                mrxs.xact().billings().sort(function(a, b) {
                    return a.billing_ts() > b.billing_ts() ? -1 : 1
                })
            );

            mrxs.xact().payments(
                mrxs.xact().payments().sort(function(a, b) {
                    return a.payment_ts() > b.payment_ts() ? -1 : 1
                })
            );

            $scope.mrxs = mrxs;
            mrxSvc.sort_payments(mrxs);
            $scope.select_refund_amt = true;
        });
    }

    $scope.return_to_list = function() {
         // navigate to the detail view on double-click
        $location.path('/circ/refunds/list');
    }

    $scope.invalid_refund_amount = function() {
        if (!$scope.mrxs) return false;

        var amt = Number($scope.mrxs.refund_amount());

        if (amt < 0 || amt > Number($scope.mrxs.refundable_paid())) 
            return true;

        // $0.00 is not a valid amount when marking as refunded, 
        // but OK otherwise.
        if ($scope.xact_state == 'refunded') return amt == 0;

        return false;
    }

    $scope.apply_updates = function() {
        var args = {
            notes : $scope.mrxs.notes(),
            refund_amount : $scope.mrxs.refund_amount()
        };

        args.clear_action = $scope.xact_state == 'pending';
        args.refund = $scope.xact_state == 'refunded';
        args.reject = $scope.xact_state == 'rejected';

        args.update_payments = [];
        angular.forEach($scope.mrxs.refundable_payments(),
            function(pay) {
                if (pay.refunded_via()) {
                    args.update_payments.push(
                        {id : pay.id(), refunded_via : pay.refunded_via()});
                }
            }
        );

        egCore.net.request(
            'open-ils.circ',
            'open-ils.circ.refundable_xact.update',
            egCore.auth.token(), $scope.mrxs.id(), args
        ).then(function(result) {
            var evt = egCore.evt.parse(result);
            if (evt) {
                alert(evt);
            } else {
                load_data(); // refresh
            }
        });
    }

    load_data();
}])


