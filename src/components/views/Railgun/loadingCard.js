import React, {Component} from "react";
import {Query} from "react-apollo";
import {Container, Row, Col} from "helpers/reactstrap";
import gql from "graphql-tag.macro";
import SubscriptionHelper from "helpers/subscriptionHelper";
import Loader from "./loader";
import "./style.scss";

const fragment = gql`
  fragment RailgunLoadingData on Railgun {
    id
    displayName
    damage {
      damaged
    }
    power {
      power
      powerLevels
    }
    ammo
    maxAmmo
    availableAmmo
  }
`;

export const RAILGUN_LOADING_QUERY = gql`
  query Railgun($simulatorId: ID!) {
    railgun(simulatorId: $simulatorId) {
      ...RailgunLoadingData
    }
  }
  ${fragment}
`;
export const RAILGUN_LOADING_SUB = gql`
  subscription RailgunUpdate($simulatorId: ID!) {
    railgunUpdate(simulatorId: $simulatorId) {
      ...RailgunLoadingData
    }
  }
  ${fragment}
`;

class RailgunLoadingData extends Component {
  state = {};
  render() {
    return (
      <Query
        query={RAILGUN_LOADING_QUERY}
        variables={{simulatorId: this.props.simulator.id}}
      >
        {({loading, data, subscribeToMore}) => {
          if (loading || !data) return null;
          const {railgun} = data;
          if (!railgun[0]) return <div>No Railgun</div>;
          return (
            <SubscriptionHelper
              subscribe={() =>
                subscribeToMore({
                  document: RAILGUN_LOADING_SUB,
                  variables: {simulatorId: this.props.simulator.id},
                  updateQuery: (previousResult, {subscriptionData}) => {
                    return Object.assign({}, previousResult, {
                      railgun: subscriptionData.data.railgunUpdate,
                    });
                  },
                })
              }
            >
              <Container>
                <Row>
                  <Col sm={7}>
                    <Loader {...this.props} {...railgun[0]} />
                  </Col>
                </Row>
              </Container>
            </SubscriptionHelper>
          );
        }}
      </Query>
    );
  }
}

export default RailgunLoadingData;
